import type { BatchResult, RunOutcome } from '../domain/outcome.ts';
import type { Forge } from '../forge/forge.ts';
import { createGit, type Git } from '../git/git.ts';
import type { HerdrApi } from '../herdr/api.ts';
import type { Tracker } from '../tracker/tracker.ts';
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
 * another, and a Batch has no all-or-nothing outcome. They are executed one after
 * another for now; concurrency across Specs is a later Ticket.
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

  const specs = await options.tracker.readySpecs();
  log(`batch: ${String(specs.length)} ready Spec(s)`);

  const runs: RunOutcome[] = [];
  for (const spec of specs) {
    runs.push(await runSpec(spec, context));
  }

  return { runs };
}
