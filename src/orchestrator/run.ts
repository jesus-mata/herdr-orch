import path from 'node:path';
import { IMPLEMENT } from '../domain/phase.ts';
import type {
  EscalatedRun,
  RunLocation,
  RunOutcome,
  TicketCommit,
} from '../domain/outcome.ts';
import type { Spec, Ticket } from '../domain/spec.ts';
import type { Forge } from '../forge/forge.ts';
import type { Git } from '../git/git.ts';
import type { HerdrApi } from '../herdr/api.ts';
import { SETTLED_AGENT_STATUSES, type AgentStatus } from '../herdr/protocol.ts';
import { commitMessage, pullRequestBody, pullRequestTitle } from './deliverable.ts';
import { branchFor, tabLabel, workerIdentity, workspaceLabel, worktreeDirName } from './naming.ts';
import { implementPrompt } from './prompt.ts';

/** How a [[Worker]] is launched. Per-Phase selection is not here yet. */
export interface WorkerSettings {
  /** A herdr agent kind — `claude`, `codex`. */
  readonly kind: string;
  readonly args?: readonly string[] | undefined;
  readonly startupTimeoutMs?: number | undefined;
  /**
   * How long a [[Phase]] may take. Undefined waits as long as herdr does, which is
   * indefinitely: what a sensible cap is comes from real Batches, not a guess.
   */
  readonly promptTimeoutMs?: number | undefined;
}

export interface RunContext {
  readonly forge: Forge;
  readonly herdr: HerdrApi;
  readonly git: Git;
  /** The repository the Run's worktree is linked to. */
  readonly repoRoot: string;
  /** Where Run worktrees live on disk. */
  readonly workspaceRoot: string;
  readonly worker: WorkerSettings;
  readonly log: (message: string) => void;
}

/**
 * One [[Spec]]'s journey from picked-up to human-reviewable [[Deliverable]].
 *
 * The skeleton's Pipeline is one [[Phase]]: implement. What is real here is
 * everything around it — the worktree and branch, the herdr topology, the fresh
 * [[Worker]], the commit, the push, the pull request — because that is every
 * integration point the rest of the system layers onto.
 *
 * It returns rather than throws. A [[Run]] that cannot proceed is an
 * [[Escalation]], which is an outcome the morning's reader can act on; an
 * exception escaping here would take the whole [[Batch]] with it.
 */
export async function runSpec(spec: Spec, context: RunContext): Promise<RunOutcome> {
  const commits: TicketCommit[] = [];
  let preserved: RunLocation | undefined;
  let stoppedAt = 'intake';

  const escalate = (reason: string, cause?: unknown): EscalatedRun => {
    context.log(`${spec.reference}: escalated at ${stoppedAt}: ${reason}`);
    return { kind: 'escalated', spec, stoppedAt, reason, preserved, commits, cause };
  };

  try {
    const [ticket, ...rest] = spec.tickets;
    if (ticket === undefined) {
      return escalate(`Spec ${spec.reference} has no Tickets.`);
    }
    if (rest.length > 0) {
      return escalate(
        `Spec ${spec.reference} has ${String(spec.tickets.length)} Tickets, and the ` +
          'walking skeleton runs a Spec of exactly one. Sequential multi-Ticket Runs are ' +
          'not built yet.',
      );
    }
    if (ticket.needsHuman) {
      return escalate(
        `Ticket ${ticket.reference} is marked as needing a human, and a HITL Ticket is ` +
          'never attempted. Resolve the decision it names, then re-run the Spec.',
      );
    }

    const base = await context.forge.defaultBranch();
    const branch = branchFor(spec);
    const requestedPath = path.join(context.workspaceRoot, worktreeDirName(spec));

    stoppedAt = `creating the worktree for ${spec.reference}`;
    context.log(`${spec.reference}: creating worktree ${requestedPath} on ${branch} from ${base}`);
    const workspace = await context.herdr.createWorktreeWorkspace({
      cwd: context.repoRoot,
      branch,
      base,
      path: requestedPath,
      label: workspaceLabel(spec),
      focus: false,
    });
    const worktreePath = workspace.worktree.path;
    // From here on there is work on disk, so every escalation says where it is.
    preserved = { branch, worktreePath };

    const phaseAt = `the ${IMPLEMENT} Phase of Ticket ${ticket.reference}`;
    stoppedAt = phaseAt;

    const identity = workerIdentity(spec, ticket, IMPLEMENT);
    const tab = await context.herdr.createTab({
      workspaceId: workspace.workspace.workspace_id,
      cwd: worktreePath,
      label: tabLabel(ticket),
      focus: false,
    });
    const paneId = tab.rootPane.pane_id;
    // Before the agent, not after: a Worker started in an unlabelled pane is one a
    // crash can orphan in the window between the two calls.
    await context.herdr.renamePane(paneId, identity);
    await context.herdr.startAgent({
      paneId,
      name: identity,
      kind: context.worker.kind,
      args: context.worker.args,
      startupTimeoutMs: context.worker.startupTimeoutMs,
    });

    const baseCommit = await context.git.headCommit(worktreePath);
    context.log(`${spec.reference}: prompting ${identity}`);
    const settled = await context.herdr.promptAgent({
      target: paneId,
      text: implementPrompt(spec, ticket),
      timeoutMs: context.worker.promptTimeoutMs,
    });

    if (settled.agent_status === 'blocked') {
      return escalate(
        `the Worker is blocked, waiting for a human. Nobody answered, so ${phaseAt} did not ` +
          'finish. Its pane is still open.',
      );
    }
    if (!isSettled(settled.agent_status)) {
      return escalate(
        `the Worker never settled: herdr reports it as ${settled.agent_status}. Liveness has ` +
          'stopped being trustworthy for this pane.',
      );
    }

    stoppedAt = `committing ${ticket.reference}`;
    const commit = await commitTicket(context, ticket, worktreePath, baseCommit);
    if (commit === undefined) {
      stoppedAt = phaseAt;
      return escalate(
        'the Worker changed nothing. herdr says it finished, which says only that it stopped ' +
          'talking — read its pane to find out why.',
      );
    }
    commits.push(commit);

    stoppedAt = `pushing ${branch}`;
    context.log(`${spec.reference}: pushing ${branch}`);
    await context.forge.pushBranch(branch);

    stoppedAt = `opening the pull request for ${spec.reference}`;
    const pullRequest = await context.forge.openPullRequest({
      branch,
      base,
      title: pullRequestTitle(spec),
      body: pullRequestBody(spec, commits),
    });
    context.log(`${spec.reference}: delivered ${pullRequest.url}`);

    return { kind: 'delivered', spec, location: preserved, commits, pullRequest };
  } catch (error) {
    return escalate(describe(error), error);
  }
}

/**
 * Turns whatever the Worker left in the tree into this Ticket's one commit.
 *
 * Undefined means it produced nothing at all. A Worker that committed its own work
 * despite being told not to is not a failure — its commit is the Ticket's commit,
 * and refusing it would throw away real work over a matter of manners.
 */
async function commitTicket(
  context: RunContext,
  ticket: Ticket,
  worktreePath: string,
  baseCommit: string,
): Promise<TicketCommit | undefined> {
  const staged = await context.git.stageAllChanges(worktreePath);
  const commit = staged
    ? await context.git.commit(worktreePath, commitMessage(ticket))
    : await context.git.headCommit(worktreePath);

  if (commit === baseCommit) return undefined;
  return { ticketId: ticket.id, reference: ticket.reference, commit };
}

function isSettled(status: AgentStatus): boolean {
  return SETTLED_AGENT_STATUSES.includes(status);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
