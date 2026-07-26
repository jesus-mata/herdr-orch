import type { BatchResult, EscalatedRun, RunOutcome } from '../domain/outcome.ts';
import type { Forge } from '../forge/forge.ts';
import { createGit, type Git } from '../git/git.ts';
import type { HerdrApi } from '../herdr/api.ts';
import type { RefusedSpec, Tracker } from '../tracker/tracker.ts';
import { runSpec, type WorkerSettings } from './run.ts';

/** The agent kind a [[Worker]] runs by default. Per-Phase selection comes later. */
const DEFAULT_WORKER_KIND = 'claude';

export interface BatchOptions {
  readonly tracker: Tracker;
  readonly forge: Forge;
  readonly herdr: HerdrApi;
  /** Where Run worktrees live on disk. */
  readonly workspaceRoot: string;
  /** The repository worktrees are linked to. Defaults to the working directory. */
  readonly repoRoot?: string | undefined;
  readonly worker?: Partial<WorkerSettings> | undefined;
  /** Injectable only so a test can watch the argv; production wants the real thing. */
  readonly git?: Git | undefined;
  /**
   * Narration, for a human reading the terminal or a log the morning after. It is
   * not the record: the record is the returned outcomes, and later the Run journal.
   */
  readonly log?: ((message: string) => void) | undefined;
}

/**
 * The [[Batch]] entry point — the seam.
 *
 * Everything above this line is real: intake, the herdr topology, the [[Worker]]
 * lifecycle, the commit, the [[Deliverable]]. Below it are four collaborators, and
 * a test replaces them with a Tracker and Forge that record, a herdr that performs
 * a Worker's real side effects in a real temporary repository, and a workspace root
 * inside it.
 *
 * Runs are independent, because [[Spec]]s are: one escalating never affects
 * another, and a Batch has no all-or-nothing outcome. That holds at intake too —
 * a Spec whose Tickets could not be read arrives as a refusal and becomes its own
 * [[Escalation]], leaving the rest of the night intact. They are executed one
 * after another for now; concurrency across Specs is a later Ticket.
 *
 * This rejects for one thing only: a backlog that could not be read at all. There
 * is no Batch then, and so no Run to escalate.
 */
export async function runBatch(options: BatchOptions): Promise<BatchResult> {
  const log = options.log ?? ((): void => undefined);
  const context = {
    forge: options.forge,
    herdr: options.herdr,
    git: options.git ?? createGit(),
    repoRoot: options.repoRoot ?? process.cwd(),
    workspaceRoot: options.workspaceRoot,
    worker: { kind: DEFAULT_WORKER_KIND, ...options.worker },
    log,
  };

  const intakes = await options.tracker.readySpecs();
  log(`batch: ${String(intakes.length)} ready Spec(s)`);

  const runs: RunOutcome[] = [];
  for (const intake of intakes) {
    runs.push(
      intake.kind === 'ready' ? await runSpec(intake.spec, context) : refuse(intake, log),
    );
  }

  return { runs };
}

/**
 * An intake refusal, as the outcome a human reads in the morning.
 *
 * It is an [[Escalation]] like any other, and deliberately so: a Spec that was
 * refused and a Spec that failed halfway are both work that did not happen, and
 * both have to say so somewhere the morning's reader is already looking. Nothing
 * was created, so nothing is preserved.
 */
function refuse(refused: RefusedSpec, log: (message: string) => void): EscalatedRun {
  log(`${refused.spec.reference}: escalated at intake: ${refused.reason}`);
  return {
    kind: 'escalated',
    spec: refused.spec,
    stoppedAt: 'intake',
    reason: refused.reason,
    preserved: undefined,
    commits: [],
    cause: refused.cause,
  };
}
