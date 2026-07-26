import { runCommand, type CommandRunner } from '../process/command.ts';

export interface AddWorktreeOptions {
  /** The repository the worktree is linked to. */
  readonly repoRoot: string;
  /** Where the worktree's working tree goes. Created by git; must not exist. */
  readonly path: string;
  /** The branch to create for it. One branch per Run, per ADR-0002. */
  readonly branch: string;
  /** The commit-ish the branch starts at, normally the Forge's default branch. */
  readonly base: string;
}

/**
 * Real Git, shelled out to.
 *
 * The Orchestrator does not reimplement Git and does not model it: every method
 * here is one command, and the return values are facts read back out of the
 * repository rather than state this module remembers. That matters because Git
 * state is what [[Corroboration]] and recovery are defined against — a cached
 * answer here would be a claim, not a fact.
 */
export interface Git {
  /** Runs git in `cwd` and returns trimmed stdout. The escape hatch. */
  exec(args: readonly string[], cwd: string): Promise<string>;
  addWorktree(options: AddWorktreeOptions): Promise<void>;
  /**
   * Stages everything in the tree, including untracked files, and reports
   * whether that staged anything at all. False means the Worker changed nothing.
   */
  stageAllChanges(cwd: string): Promise<boolean>;
  /** Commits what is staged and returns the new commit. */
  commit(cwd: string, message: string): Promise<string>;
  headCommit(cwd: string): Promise<string>;
  currentBranch(cwd: string): Promise<string>;
}

export function createGit(run: CommandRunner = runCommand): Git {
  const exec = async (args: readonly string[], cwd: string): Promise<string> => {
    const result = await run('git', args, { cwd });
    return result.stdout.trim();
  };

  return {
    exec,

    addWorktree: async (options) => {
      await exec(
        ['worktree', 'add', '-b', options.branch, options.path, options.base],
        options.repoRoot,
      );
    },

    stageAllChanges: async (cwd) => {
      await exec(['add', '-A'], cwd);
      // `diff --cached --name-only` rather than `--quiet`: the exit code that
      // means "there are changes" is indistinguishable from a real failure, and
      // the Orchestrator must not read a broken repository as a busy one.
      const staged = await exec(['diff', '--cached', '--name-only'], cwd);
      return staged !== '';
    },

    commit: async (cwd, message) => {
      // `--no-verify`: a commit hook is the human's own gate on their own commits,
      // and an unattended Run must not be stopped by one that prompts or reformats.
      // Checking the work is Corroboration's job, which runs the checks itself.
      await exec(['commit', '--no-verify', '-m', message], cwd);
      return await exec(['rev-parse', 'HEAD'], cwd);
    },

    headCommit: (cwd) => exec(['rev-parse', 'HEAD'], cwd),

    currentBranch: (cwd) => exec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
  };
}
