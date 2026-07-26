import { AgentStatusWatcher, type ReconnectPolicy } from './agent-status-watcher.ts';
import type { HerdrApi } from './api.ts';
import { HerdrRequestTransport, type SendOptions } from './transport.ts';
import type { SocketPathEnv } from './socket-path.ts';
import {
  SETTLED_AGENT_STATUSES,
  BLOCKED_AGENT_STATUS,
  type AgentInfo,
  type AgentStatus,
  type AgentStatusChange,
  type PaneInfo,
  type PaneReadResult,
  type ReadSource,
  type SessionSnapshot,
  type TabInfo,
  type WorkspaceInfo,
  type WorktreeInfo,
} from './protocol.ts';

/**
 * Extra time beyond herdr's own wait before the transport gives up. herdr's
 * timeout produces a precise error; ours produces "it went quiet". Letting
 * herdr's fire first means the Orchestrator gets the better of the two.
 */
const TRANSPORT_GRACE_MS = 5_000;

export interface HerdrClientOptions {
  readonly socketPath?: string | undefined;
  readonly session?: string | undefined;
  readonly env?: SocketPathEnv | undefined;
  readonly defaultTimeoutMs?: number | null | undefined;
  readonly connectTimeoutMs?: number | undefined;
  readonly reconnect?: ReconnectPolicy | undefined;
}

export interface Pong {
  readonly type: 'pong';
  readonly version: string;
  readonly protocol: number;
  readonly capabilities: Record<string, boolean>;
}

export interface WorktreeWorkspace {
  readonly workspace: WorkspaceInfo;
  readonly tab: TabInfo;
  readonly rootPane: PaneInfo;
  readonly worktree: WorktreeInfo;
}

export interface CreatedTab {
  readonly tab: TabInfo;
  readonly rootPane: PaneInfo;
}

export interface CreateWorktreeWorkspaceOptions {
  readonly cwd?: string | undefined;
  readonly branch?: string | undefined;
  readonly base?: string | undefined;
  readonly path?: string | undefined;
  readonly label?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly focus?: boolean | undefined;
}

export interface CreateTabOptions {
  readonly workspaceId?: string | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly label?: string | undefined;
  readonly focus?: boolean | undefined;
}

export interface SplitPaneOptions {
  readonly direction: 'right' | 'down';
  readonly targetPaneId?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly ratio?: number | undefined;
  readonly focus?: boolean | undefined;
}

export interface StartAgentOptions {
  readonly paneId: string;
  /** The label herdr shows for this agent. */
  readonly name: string;
  /** A herdr agent kind, e.g. `claude` or `codex`. */
  readonly kind: string;
  readonly args?: readonly string[] | undefined;
  /** Interactive-readiness timeout. herdr requires >3000 and <=300000. */
  readonly startupTimeoutMs?: number | undefined;
}

export interface PromptAgentOptions {
  /** A pane id or an agent name. */
  readonly target: string;
  readonly text: string;
  /** Widened to always include `blocked`. */
  readonly until?: readonly AgentStatus[] | undefined;
  /** Omitted means wait indefinitely, as herdr does. */
  readonly timeoutMs?: number | undefined;
}

export interface WaitForAgentOptions {
  readonly target: string;
  readonly until?: readonly AgentStatus[] | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface ReadPaneOptions {
  readonly paneId: string;
  readonly source: ReadSource;
  readonly lines?: number | undefined;
  readonly format?: 'text' | 'ansi' | undefined;
  readonly stripAnsi?: boolean | undefined;
}

/**
 * The Orchestrator's view of herdr.
 *
 * Typed wrappers for the methods in use, plus the two protocol details the
 * design deliberately keeps here rather than in callers: a prompt always waits on
 * `blocked` as well as the finished states, and pane agent status is observed
 * through a subscription that reconnects and reconciles rather than through
 * polling.
 *
 * Everything above this line speaks the Orchestrator's vocabulary; everything
 * below speaks herdr's wire format.
 *
 * The `HerdrApi` it implements is the narrower surface a [[Run]] depends on, and
 * the one the scripted-agent test fake stands in for.
 */
export class HerdrClient implements HerdrApi {
  readonly #transport: HerdrRequestTransport;
  #watcher: AgentStatusWatcher | undefined;
  readonly #reconnect: ReconnectPolicy | undefined;
  readonly #connectTimeoutMs: number | undefined;
  readonly #changeListeners: ((change: AgentStatusChange) => void)[] = [];
  readonly #watcherErrorListeners: ((error: Error) => void)[] = [];

  constructor(options: HerdrClientOptions = {}) {
    this.#transport = new HerdrRequestTransport({
      socketPath: options.socketPath,
      session: options.session,
      env: options.env,
      defaultTimeoutMs: options.defaultTimeoutMs,
      connectTimeoutMs: options.connectTimeoutMs,
    });
    this.#reconnect = options.reconnect;
    this.#connectTimeoutMs = options.connectTimeoutMs;
  }

  get socketPath(): string {
    return this.#transport.socketPath;
  }

  /** Escape hatch for a method without a wrapper yet. */
  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    options?: SendOptions,
  ): Promise<T> {
    return this.#transport.send<T>(method, params, options);
  }

  async ping(): Promise<Pong> {
    return await this.#transport.send<Pong>('ping', {});
  }

  async sessionSnapshot(): Promise<SessionSnapshot> {
    const result = await this.#transport.send<{ snapshot: SessionSnapshot }>(
      'session.snapshot',
      {},
    );
    return result.snapshot;
  }

  async createWorktreeWorkspace(
    options: CreateWorktreeWorkspaceOptions,
  ): Promise<WorktreeWorkspace> {
    const result = await this.#transport.send<{
      workspace: WorkspaceInfo;
      tab: TabInfo;
      root_pane: PaneInfo;
      worktree: WorktreeInfo;
    }>(
      'worktree.create',
      compact({
        cwd: options.cwd,
        branch: options.branch,
        base: options.base,
        path: options.path,
        label: options.label,
        workspace_id: options.workspaceId,
        focus: options.focus ?? false,
      }),
    );

    return {
      workspace: result.workspace,
      tab: result.tab,
      rootPane: result.root_pane,
      worktree: result.worktree,
    };
  }

  async createTab(options: CreateTabOptions = {}): Promise<CreatedTab> {
    const result = await this.#transport.send<{ tab: TabInfo; root_pane: PaneInfo }>(
      'tab.create',
      compact({
        workspace_id: options.workspaceId,
        cwd: options.cwd,
        env: options.env,
        label: options.label,
        focus: options.focus ?? false,
      }),
    );

    return { tab: result.tab, rootPane: result.root_pane };
  }

  async closeTab(tabId: string): Promise<void> {
    await this.#transport.send('tab.close', { tab_id: tabId });
  }

  async splitPane(options: SplitPaneOptions): Promise<PaneInfo> {
    const result = await this.#transport.send<{ pane: PaneInfo }>(
      'pane.split',
      compact({
        direction: options.direction,
        target_pane_id: options.targetPaneId,
        workspace_id: options.workspaceId,
        cwd: options.cwd,
        env: options.env,
        ratio: options.ratio,
        focus: options.focus ?? false,
      }),
    );

    return result.pane;
  }

  /** `undefined` clears the label and restores herdr's own naming. */
  async renamePane(paneId: string, label: string | undefined): Promise<void> {
    await this.#transport.send('pane.rename', { pane_id: paneId, label: label ?? null });
  }

  async closePane(paneId: string): Promise<void> {
    await this.#transport.send('pane.close', { pane_id: paneId });
  }

  async readPane(options: ReadPaneOptions): Promise<PaneReadResult> {
    const result = await this.#transport.send<{ read: PaneReadResult }>(
      'pane.read',
      compact({
        pane_id: options.paneId,
        source: options.source,
        lines: options.lines,
        format: options.format,
        strip_ansi: options.stripAnsi ?? true,
      }),
    );

    return result.read;
  }

  async listPanes(): Promise<readonly PaneInfo[]> {
    const result = await this.#transport.send<{ panes: PaneInfo[] }>('pane.list', {});
    return result.panes;
  }

  async listAgents(): Promise<readonly AgentInfo[]> {
    const result = await this.#transport.send<{ agents: AgentInfo[] }>('agent.list', {});
    return result.agents;
  }

  async getAgent(target: string): Promise<AgentInfo> {
    const result = await this.#transport.send<{ agent: AgentInfo }>('agent.get', {
      target,
    });
    return result.agent;
  }

  async startAgent(options: StartAgentOptions): Promise<AgentInfo> {
    const result = await this.#transport.send<{ agent: AgentInfo }>(
      'agent.start',
      compact({
        pane_id: options.paneId,
        name: options.name,
        kind: options.kind,
        args: options.args,
        timeout_ms: options.startupTimeoutMs,
      }),
      // Starting an agent waits for interactive readiness, which herdr allows up
      // to 300s for; the transport must not give up before herdr does.
      { timeoutMs: transportDeadline(options.startupTimeoutMs) },
    );

    return result.agent;
  }

  /**
   * Submits a prompt and waits for the Worker to settle.
   *
   * Always waits on `blocked` in addition to whatever was asked for. This is the
   * invariant, not a default: a Worker stopped at a permission prompt never
   * reaches a finished state, and a wait that excluded `blocked` would spend the
   * Phase's whole timeout on a dialog no one is awake to answer.
   */
  async promptAgent(options: PromptAgentOptions): Promise<AgentInfo> {
    const until = withBlocked(options.until);
    const result = await this.#transport.send<{ agent: AgentInfo }>(
      'agent.prompt',
      {
        target: options.target,
        text: options.text,
        wait: compact({ until, timeout_ms: options.timeoutMs }),
      },
      { timeoutMs: transportDeadline(options.timeoutMs) },
    );

    return result.agent;
  }

  /** Waits for an already-running Worker to settle. Also always includes `blocked`. */
  async waitForAgent(options: WaitForAgentOptions): Promise<AgentInfo> {
    const result = await this.#transport.send<{ agent: AgentInfo }>(
      'agent.wait',
      compact({
        target: options.target,
        until: withBlocked(options.until),
        timeout_ms: options.timeoutMs,
      }),
      { timeoutMs: transportDeadline(options.timeoutMs) },
    );

    return result.agent;
  }

  onAgentStatusChange(listener: (change: AgentStatusChange) => void): void {
    this.#changeListeners.push(listener);
    this.#watcher?.onChange(listener);
  }

  /** Fires when agent status has stopped being observable and cannot be restored. */
  onAgentStatusUnavailable(listener: (error: Error) => void): void {
    this.#watcherErrorListeners.push(listener);
    this.#watcher?.onError(listener);
  }

  async watchAgentStatus(paneId: string): Promise<void> {
    await this.#ensureWatcher().watch(paneId);
  }

  async unwatchAgentStatus(paneId: string): Promise<void> {
    await this.#watcher?.unwatch(paneId);
  }

  lastAgentStatus(paneId: string): AgentStatus | undefined {
    return this.#watcher?.lastStatus(paneId);
  }

  /** Releases the subscription, including one still being established. */
  async close(): Promise<void> {
    const watcher = this.#watcher;
    this.#watcher = undefined;
    await watcher?.close();
  }

  #ensureWatcher(): AgentStatusWatcher {
    this.#watcher ??= this.#createWatcher();
    return this.#watcher;
  }

  #createWatcher(): AgentStatusWatcher {
    const watcher = new AgentStatusWatcher({
      transport: this.#transport,
      reconnect: this.#reconnect,
      connectTimeoutMs: this.#connectTimeoutMs,
    });
    for (const listener of this.#changeListeners) watcher.onChange(listener);
    for (const listener of this.#watcherErrorListeners) watcher.onError(listener);
    return watcher;
  }
}

function withBlocked(until: readonly AgentStatus[] | undefined): AgentStatus[] {
  if (until === undefined || until.length === 0) return [...SETTLED_AGENT_STATUSES];
  return [...new Set([...until, BLOCKED_AGENT_STATUS])];
}

function transportDeadline(herdrTimeoutMs: number | undefined): number | null {
  // herdr waits indefinitely when given no timeout, so we must too; a transport
  // deadline here would abandon a Worker that is still legitimately working.
  return herdrTimeoutMs === undefined ? null : herdrTimeoutMs + TRANSPORT_GRACE_MS;
}

function compact(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  );
}
