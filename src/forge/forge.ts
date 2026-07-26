import type { PullRequest } from '../domain/outcome.ts';

export interface PullRequestRequest {
  /** The branch carrying the [[Run]]'s commits. */
  readonly branch: string;
  /** What it is opened against — the Forge's default branch. */
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

/**
 * Where the code goes: the host that holds the branch and the pull request.
 *
 * A Forge is constructed for one repository, so nothing here names one. It never
 * merges: opening the pull request is the end of a [[Run]], and human review
 * before merge is the point.
 */
export interface Forge {
  /** The branch a [[Deliverable]] is opened against, and a Run's worktree based on. */
  defaultBranch(): Promise<string>;
  pushBranch(branch: string): Promise<void>;
  openPullRequest(request: PullRequestRequest): Promise<PullRequest>;
}
