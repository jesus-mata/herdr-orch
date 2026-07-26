export { runBatch } from './orchestrator/batch.ts';
export type { BatchOptions } from './orchestrator/batch.ts';
export { runSpec } from './orchestrator/run.ts';
export type { RunContext, WorkerSettings } from './orchestrator/run.ts';
export { ORCH_PREFIX, branchFor, workerIdentity, worktreeDirName } from './orchestrator/naming.ts';
export { implementPrompt } from './orchestrator/prompt.ts';
export { commitMessage, pullRequestBody, pullRequestTitle } from './orchestrator/deliverable.ts';

export type { Spec, Ticket } from './domain/spec.ts';
export type { PhaseName } from './domain/phase.ts';
export { IMPLEMENT } from './domain/phase.ts';
export type {
  BatchResult,
  DeliveredRun,
  EscalatedRun,
  PullRequest,
  RunLocation,
  RunOutcome,
  TicketCommit,
} from './domain/outcome.ts';
export { IntakeError } from './domain/errors.ts';

export type { ReadySpec, RefusedSpec, SpecIntake, Tracker } from './tracker/tracker.ts';
export { createGitHubTracker } from './tracker/github-tracker.ts';
export type { GitHubTrackerOptions } from './tracker/github-tracker.ts';
export { parseTicketBody } from './tracker/ticket-body.ts';
export type { TicketBody } from './tracker/ticket-body.ts';

export type { Forge, PullRequestRequest } from './forge/forge.ts';
export { createGitHubForge } from './forge/github-forge.ts';
export type { GitHubForgeOptions } from './forge/github-forge.ts';

export { createGit } from './git/git.ts';
export type { AddWorktreeOptions, Git } from './git/git.ts';

export { CommandError, runCommand } from './process/command.ts';
export type { CommandOptions, CommandResult, CommandRunner } from './process/command.ts';

export { HerdrClient } from './herdr/index.ts';
export type { HerdrApi } from './herdr/index.ts';
