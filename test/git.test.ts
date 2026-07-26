import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createGit } from '../src/git/git.ts';
import { createTempRepo, type TempRepo } from './helpers/temp-repo.ts';

describe('git operations', () => {
  let repo: TempRepo;
  const git = createGit();

  before(async () => {
    repo = await createTempRepo();
  });

  after(() => {
    repo.cleanup();
  });

  it('adds a worktree on a new branch from a base', async () => {
    const worktreePath = path.join(repo.workspaceRoot, 'wt-add');

    await git.addWorktree({
      repoRoot: repo.path,
      path: worktreePath,
      branch: 'orch/wt-add',
      base: repo.defaultBranch,
    });

    assert.equal(repo.exists('README.md', worktreePath), true);
    assert.equal(await git.currentBranch(worktreePath), 'orch/wt-add');
    assert.equal(
      await git.headCommit(worktreePath),
      await git.headCommit(repo.path),
      'a fresh worktree starts at the base commit',
    );
  });

  it('reports no work when the tree is untouched, and commits it when there is', async () => {
    const worktreePath = path.join(repo.workspaceRoot, 'wt-commit');
    await git.addWorktree({
      repoRoot: repo.path,
      path: worktreePath,
      branch: 'orch/wt-commit',
      base: repo.defaultBranch,
    });
    const base = await git.headCommit(worktreePath);

    assert.equal(await git.stageAllChanges(worktreePath), false);

    repo.write('src/feature.ts', 'export const feature = true;\n', worktreePath);
    assert.equal(await git.stageAllChanges(worktreePath), true, 'untracked files count as work');

    const commit = await git.commit(worktreePath, 'Add the feature\n\nTicket: #3');

    assert.notEqual(commit, base);
    assert.equal(await git.headCommit(worktreePath), commit);
    assert.equal(await git.stageAllChanges(worktreePath), false, 'the commit consumed the change');
    assert.match(await repo.git(['log', '-1', '--pretty=%B'], worktreePath), /Ticket: #3/);
    assert.equal(
      await repo.git(['show', '--name-only', '--pretty=', commit], worktreePath),
      'src/feature.ts',
    );
  });

  it('surfaces a git failure as an error naming the command', async () => {
    await assert.rejects(
      () => git.currentBranch(path.join(repo.workspaceRoot, 'not-a-worktree')),
      /git/,
    );
  });
});
