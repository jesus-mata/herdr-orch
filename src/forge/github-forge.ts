import type { PullRequest } from '../domain/outcome.ts';
import { runCommand, type CommandRunner } from '../process/command.ts';
import type { Forge, PullRequestRequest } from './forge.ts';

export interface GitHubForgeOptions {
  /** The repository the branch and the pull request belong to. */
  readonly repoRoot: string;
  /** `owner/name`. Left to `gh`'s own inference from `repoRoot` when omitted. */
  readonly repo?: string | undefined;
  readonly remote?: string | undefined;
  readonly run?: CommandRunner | undefined;
}

/**
 * GitHub as a [[Forge]]: `git push`, then `gh pr create`.
 *
 * Two things it will not do. It never force-pushes — a Run's branch is its own and
 * has nothing to rewrite, so a force here could only ever be destroying something
 * that was not the Run's. And it never merges: the pull request is where a [[Run]]
 * ends, because human review before merge is the point.
 *
 * Fetching and pushing run in `repoRoot` rather than in the Run's worktree. A
 * linked worktree shares the repository's refs, so the branch is pushable and the
 * base fetchable from either, and the main repository is the one place that is
 * certain to still exist.
 */
export function createGitHubForge(options: GitHubForgeOptions): Forge {
  const run = options.run ?? runCommand;
  const remote = options.remote ?? 'origin';
  const repoArgs = options.repo === undefined ? [] : ['--repo', options.repo];
  let defaultBranch: string | undefined;

  const gh = async (args: readonly string[]): Promise<string> => {
    const result = await run('gh', args, { cwd: options.repoRoot });
    return result.stdout;
  };

  const readDefaultBranch = async (): Promise<string> => {
    defaultBranch ??= (
      await gh([
        'repo',
        'view',
        ...repoArgs,
        '--json',
        'defaultBranchRef',
        '--jq',
        '.defaultBranchRef.name',
      ])
    ).trim();
    return defaultBranch;
  };

  return {
    defaultBranch: readDefaultBranch,

    fetchBase: async () => {
      const branch = await readDefaultBranch();
      // Fetched every Run rather than once a Batch: a Run that started at 3am
      // should begin from what the default branch held at 3am.
      await run('git', ['fetch', remote, branch], { cwd: options.repoRoot });
      return `${remote}/${branch}`;
    },

    pushBranch: async (branch) => {
      await run('git', ['push', '--set-upstream', remote, branch], { cwd: options.repoRoot });
    },

    openPullRequest: async (request: PullRequestRequest): Promise<PullRequest> => {
      const stdout = await gh([
        'pr',
        'create',
        ...repoArgs,
        '--base',
        request.base,
        '--head',
        request.branch,
        '--title',
        request.title,
        '--body',
        request.body,
      ]);
      return readPullRequest(stdout);
    },
  };
}

/**
 * `gh pr create` prints the pull request's url, among other chatter.
 *
 * A url that cannot be found is an error rather than a Run reported as delivered
 * with nothing to open: the [[Deliverable]] is the only human touchpoint, so an
 * unverifiable one is worse than none.
 */
function readPullRequest(stdout: string): PullRequest {
  const match = /https:\/\/\S*?\/pull\/(\d+)/.exec(stdout);
  const number = match?.[1];
  if (match === null || number === undefined) {
    throw new Error(
      `gh pr create printed no pull request url, so there is nothing to deliver: ${stdout.trim()}`,
    );
  }
  return { number: Number(number), url: match[0] };
}
