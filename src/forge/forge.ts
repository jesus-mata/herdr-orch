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
  /** The branch a [[Deliverable]] is opened against. */
  defaultBranch(): Promise<string>;
  /**
   * Brings the default branch up to date and returns the ref a [[Run]]'s worktree
   * starts at.
   *
   * A Run bases on the remote's branch rather than the local one, because an
   * unattended Orchestrator never pulls: the local branch is as old as the last
   * time a human did, and a Worker building on a week-old base says nothing about
   * it. Fetching lives here for the same reason pushing does — this is where the
   * remote and its credentials are.
   */
  fetchBase(): Promise<string>;
  pushBranch(branch: string): Promise<void>;
  openPullRequest(request: PullRequestRequest): Promise<PullRequest>;
}
