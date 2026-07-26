import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../../src/process/command.ts';

/**
 * A real Git repository in a temporary directory.
 *
 * Git is never faked in these tests. Worktree creation, the commit per Ticket
 * and everything recovery and the Vacuity Guard will later add are defined in
 * terms of Git state, so a fake would leave the tests asserting against the
 * fake's behaviour instead of the real invariant.
 */
export interface TempRepo {
  /** The repository's working tree — the Orchestrator's `repoRoot`. */
  readonly path: string;
  /** A directory beside the repo, standing in for the Orchestrator's workspace root. */
  readonly workspaceRoot: string;
  readonly defaultBranch: string;
  /** Runs git in the repo (or in `cwd`) and returns trimmed stdout. */
  git(args: readonly string[], cwd?: string): Promise<string>;
  write(relativePath: string, contents: string, cwd?: string): void;
  read(relativePath: string, cwd?: string): string;
  exists(relativePath: string, cwd?: string): boolean;
  cleanup(): void;
}

export async function createTempRepo(defaultBranch = 'main'): Promise<TempRepo> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-'));
  const repoPath = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'worktrees');
  fs.mkdirSync(repoPath);
  fs.mkdirSync(workspaceRoot);

  const git = async (args: readonly string[], cwd: string = repoPath): Promise<string> => {
    const result = await runCommand('git', args, { cwd });
    return result.stdout.trim();
  };

  await git(['init', '-b', defaultBranch]);
  await git(['config', 'user.name', 'Orchestrator Test']);
  await git(['config', 'user.email', 'orchestrator@example.invalid']);
  await git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# fixture\n');
  await git(['add', '-A']);
  await git(['commit', '-m', 'Initial commit']);

  return {
    path: repoPath,
    workspaceRoot,
    defaultBranch,
    git,
    write: (relativePath, contents, cwd = repoPath) => {
      const target = path.join(cwd, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    },
    read: (relativePath, cwd = repoPath) => fs.readFileSync(path.join(cwd, relativePath), 'utf8'),
    exists: (relativePath, cwd = repoPath) => fs.existsSync(path.join(cwd, relativePath)),
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
