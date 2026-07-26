/**
 * Runs one [[Batch]] against the real world: real GitHub Issues, real herdr, real
 * Workers, real pull requests.
 *
 *   node --experimental-strip-types scripts/orch-batch.ts [--workspace-root DIR] [--dry-run]
 *
 * This is the wiring, not the Orchestrator: everything it does lives behind
 * `runBatch`, and this file only chooses which Tracker, Forge and herdr client to
 * hand it. The walking skeleton runs each ready Spec of exactly one Ticket through
 * implement and stops; anything else escalates and says so.
 *
 * `--dry-run` prints the Specs intake found and starts no Worker.
 */
import os from 'node:os';
import path from 'node:path';
import { HerdrClient } from '../src/herdr/index.ts';
import { createGitHubForge } from '../src/forge/github-forge.ts';
import { createGitHubTracker } from '../src/tracker/github-tracker.ts';
import { runBatch } from '../src/orchestrator/batch.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const workspaceRootAt = args.indexOf('--workspace-root');
const repoRoot = process.cwd();
const workspaceRoot =
  workspaceRootAt === -1
    ? path.join(os.homedir(), '.herdr-orch', 'worktrees')
    : path.resolve(args[workspaceRootAt + 1] ?? '.');

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

const tracker = createGitHubTracker({ cwd: repoRoot });
const forge = createGitHubForge({ repoRoot });

if (dryRun) {
  for (const spec of await tracker.readySpecs()) {
    log(`${spec.reference} ${spec.title}`);
    for (const ticket of spec.tickets) {
      log(`  ${ticket.reference} ${ticket.title}${ticket.needsHuman ? ' (needs a human)' : ''}`);
    }
  }
  process.exit(0);
}

const herdr = new HerdrClient();
try {
  const result = await runBatch({ tracker, forge, herdr, repoRoot, workspaceRoot, log });

  log('');
  for (const run of result.runs) {
    if (run.kind === 'delivered') log(`${run.spec.reference} delivered: ${run.pullRequest.url}`);
    else {
      log(`${run.spec.reference} escalated at ${run.stoppedAt}: ${run.reason}`);
      if (run.preserved !== undefined) {
        log(`  preserved: ${run.preserved.branch} at ${run.preserved.worktreePath}`);
      }
    }
  }

  // An escalation is a legitimate outcome, not a crash — but a Batch with one in it
  // needs a human, and the exit code is what a scheduler reads.
  process.exitCode = result.runs.some((run) => run.kind === 'escalated') ? 1 : 0;
} finally {
  await herdr.close();
}
