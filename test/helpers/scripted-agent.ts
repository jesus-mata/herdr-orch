import fs from 'node:fs';
import path from 'node:path';
import { createGit } from '../../src/git/git.ts';
import type { HerdrApi } from '../../src/herdr/api.ts';
import type {
  CreateTabOptions,
  CreateWorktreeWorkspaceOptions,
  CreatedTab,
  PromptAgentOptions,
  StartAgentOptions,
  WorktreeWorkspace,
} from '../../src/herdr/client.ts';
import type { AgentInfo, AgentStatus } from '../../src/herdr/protocol.ts';

/**
 * What a scripted [[Worker]] is given when it is prompted.
 *
 * It gets a real worktree and real Git, because that is the whole point: the fake
 * stands in for herdr, not for the work. A Worker that writes files, and a
 * Orchestrator that finds them and commits them, are both real here.
 */
export interface ScriptedWorkerContext {
  /** The worktree herdr really created for this Run. */
  readonly worktreePath: string;
  readonly prompt: string;
  readonly paneId: string;
  readonly agentName: string;
  /** Which prompt this is, across the whole fake. 0 for the first. */
  readonly index: number;
  /** Writes a file in the worktree, creating parent directories. */
  write(relativePath: string, contents: string): void;
  /** Runs git in the worktree, for a Worker scripted to misbehave. */
  git(args: readonly string[]): Promise<string>;
  /**
   * The [[Liveness]] herdr will report when this Worker settles. `done` unless the
   * Worker says otherwise — which is how a test scripts one stopped at a permission
   * prompt with no language model anywhere near it.
   */
  settleAs(status: AgentStatus): void;
}

type MaybePromise<T> = T | Promise<T>;

/** A scripted Worker: the side effects a real one would have, in the real worktree. */
export type ScriptedWorker = (context: ScriptedWorkerContext) => MaybePromise<void>;

export interface ScriptedHerdrOptions {
  /** The repository worktrees are created from. */
  readonly repoRoot: string;
  /** What every prompted Worker does. Branch on `context.prompt` or `context.index`. */
  readonly worker?: ScriptedWorker | undefined;
}

export interface RecordedWorkspace {
  readonly workspaceId: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly base: string;
  readonly label: string | undefined;
}

export interface RecordedTab {
  readonly tabId: string;
  readonly workspaceId: string;
  readonly paneId: string;
  readonly cwd: string | undefined;
  readonly label: string | undefined;
}

export interface RecordedAgent {
  readonly paneId: string;
  readonly name: string;
  readonly kind: string;
  readonly args: readonly string[] | undefined;
}

export interface RecordedPrompt {
  readonly paneId: string;
  readonly agentName: string;
  readonly text: string;
  readonly timeoutMs: number | undefined;
  readonly settledAs: AgentStatus;
}

/**
 * herdr, faked at the level the Orchestrator talks to it — and only there.
 *
 * It is strict about lifecycle on purpose: a tab in a workspace that does not
 * exist, an agent in an unknown pane, a prompt to a pane with no agent, or a
 * second agent in a pane that already has one all throw. That strictness is what
 * makes the end-to-end test evidence that the integration points connect in the
 * right order, rather than evidence that five methods were called.
 *
 * It cannot catch a wire bug — framing, correlation, reconnection — because it sits
 * above the wire. Those belong to the client's own tests against a stub server.
 */
export interface ScriptedHerdr extends HerdrApi {
  readonly workspaces: readonly RecordedWorkspace[];
  readonly tabs: readonly RecordedTab[];
  readonly agents: readonly RecordedAgent[];
  readonly prompts: readonly RecordedPrompt[];
  /** Pane labels as they now stand, keyed by pane id. */
  readonly paneLabels: ReadonlyMap<string, string | undefined>;
}

export function createScriptedHerdr(options: ScriptedHerdrOptions): ScriptedHerdr {
  const git = createGit();
  const workspaces: RecordedWorkspace[] = [];
  const tabs: RecordedTab[] = [];
  const agents: RecordedAgent[] = [];
  const prompts: RecordedPrompt[] = [];
  const paneLabels = new Map<string, string | undefined>();
  /** Pane id to the worktree it was opened on, so a Worker acts in the right tree. */
  const paneCwd = new Map<string, string>();
  const agentByPane = new Map<string, RecordedAgent>();
  let counter = 0;

  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}-${String(counter)}`;
  };

  const agentInfo = (paneId: string, status: AgentStatus): AgentInfo => {
    const agent = agentByPane.get(paneId);
    return {
      pane_id: paneId,
      terminal_id: `terminal-${paneId}`,
      workspace_id: tabs.find((tab) => tab.paneId === paneId)?.workspaceId ?? 'workspace-unknown',
      tab_id: tabs.find((tab) => tab.paneId === paneId)?.tabId ?? 'tab-unknown',
      focused: false,
      agent_status: status,
      revision: counter,
      name: agent?.name ?? null,
      agent: agent?.kind ?? null,
      interactive_ready: true,
    };
  };

  return {
    workspaces,
    tabs,
    agents,
    prompts,
    paneLabels,

    createWorktreeWorkspace: async (
      created: CreateWorktreeWorkspaceOptions,
    ): Promise<WorktreeWorkspace> => {
      const branch = created.branch;
      const worktreePath = created.path;
      if (branch === undefined || worktreePath === undefined) {
        throw new Error('the scripted herdr requires an explicit branch and path');
      }

      // The side effect that matters: a real worktree on a real branch.
      await git.addWorktree({
        repoRoot: created.cwd ?? options.repoRoot,
        path: worktreePath,
        branch,
        base: created.base ?? 'HEAD',
      });

      const workspaceId = nextId('workspace');
      const tabId = nextId('tab');
      const paneId = nextId('pane');
      workspaces.push({
        workspaceId,
        branch,
        worktreePath,
        base: created.base ?? 'HEAD',
        label: created.label,
      });
      tabs.push({ tabId, workspaceId, paneId, cwd: worktreePath, label: created.label });
      paneCwd.set(paneId, worktreePath);
      paneLabels.set(paneId, undefined);

      return {
        workspace: { workspace_id: workspaceId, label: created.label ?? null },
        tab: { tab_id: tabId, workspace_id: workspaceId },
        rootPane: {
          pane_id: paneId,
          terminal_id: `terminal-${paneId}`,
          workspace_id: workspaceId,
          tab_id: tabId,
          focused: false,
          agent_status: 'idle',
          revision: counter,
          cwd: worktreePath,
        },
        worktree: { path: worktreePath, branch },
      };
    },

    createTab: (created: CreateTabOptions = {}): Promise<CreatedTab> => {
      const workspaceId = created.workspaceId;
      if (workspaceId === undefined) {
        throw new Error('the scripted herdr requires an explicit workspace for a tab');
      }
      if (!workspaces.some((workspace) => workspace.workspaceId === workspaceId)) {
        throw new Error(`no such workspace: ${workspaceId}`);
      }

      const tabId = nextId('tab');
      const paneId = nextId('pane');
      tabs.push({ tabId, workspaceId, paneId, cwd: created.cwd, label: created.label });
      if (created.cwd !== undefined) paneCwd.set(paneId, created.cwd);
      paneLabels.set(paneId, undefined);

      return Promise.resolve({
        tab: { tab_id: tabId, workspace_id: workspaceId },
        rootPane: {
          pane_id: paneId,
          terminal_id: `terminal-${paneId}`,
          workspace_id: workspaceId,
          tab_id: tabId,
          focused: false,
          agent_status: 'idle',
          revision: counter,
          cwd: created.cwd ?? null,
        },
      });
    },

    renamePane: (paneId: string, label: string | undefined): Promise<void> => {
      requirePane(paneId);
      paneLabels.set(paneId, label);
      return Promise.resolve();
    },

    startAgent: (started: StartAgentOptions): Promise<AgentInfo> => {
      requirePane(started.paneId);
      if (agentByPane.has(started.paneId)) {
        throw new Error(
          `pane ${started.paneId} already runs an agent; every Phase gets a fresh Worker`,
        );
      }
      const agent: RecordedAgent = {
        paneId: started.paneId,
        name: started.name,
        kind: started.kind,
        args: started.args,
      };
      agents.push(agent);
      agentByPane.set(started.paneId, agent);
      return Promise.resolve(agentInfo(started.paneId, 'idle'));
    },

    promptAgent: async (prompted: PromptAgentOptions): Promise<AgentInfo> => {
      const paneId = prompted.target;
      const agent = agentByPane.get(paneId);
      if (agent === undefined) throw new Error(`no agent to prompt in pane ${paneId}`);
      const worktreePath = paneCwd.get(paneId);
      if (worktreePath === undefined) throw new Error(`pane ${paneId} has no working directory`);

      const index = prompts.length;
      let settledAs: AgentStatus = 'done';
      await options.worker?.({
        worktreePath,
        prompt: prompted.text,
        paneId,
        agentName: agent.name,
        index,
        write: (relativePath, contents) => {
          const target = path.join(worktreePath, relativePath);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, contents);
        },
        git: async (args) => await git.exec(args, worktreePath),
        settleAs: (status) => {
          settledAs = status;
        },
      });

      prompts.push({
        paneId,
        agentName: agent.name,
        text: prompted.text,
        timeoutMs: prompted.timeoutMs,
        settledAs,
      });

      return agentInfo(paneId, settledAs);
    },
  };

  function requirePane(paneId: string): void {
    if (!tabs.some((tab) => tab.paneId === paneId)) throw new Error(`no such pane: ${paneId}`);
  }
}
