import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGitHubForge } from '../src/forge/github-forge.ts';
import { createFakeRunner, type RecordedCommand } from './helpers/fake-runner.ts';

const PR_URL = 'https://github.com/o/r/pull/42';

function ghStub(call: RecordedCommand): string | Error {
  if (call.command === 'git') return '';
  if (call.args[0] === 'repo') return 'main\n';
  if (call.args[0] === 'pr') return `Creating pull request...\n${PR_URL}\n`;
  return new Error(`unexpected call: ${call.args.join(' ')}`);
}

describe('the GitHub Forge adapter', () => {
  it('reads the default branch once and reuses it', async () => {
    const fake = createFakeRunner(ghStub);
    const forge = createGitHubForge({ repoRoot: '/repo', run: fake.runner });

    assert.equal(await forge.defaultBranch(), 'main');
    assert.equal(await forge.defaultBranch(), 'main');

    assert.match(fake.argv()[0] ?? '', /^gh repo view .*defaultBranchRef/);
    assert.equal(fake.calls.length, 1, 'the default branch cannot change mid-Batch');
    assert.equal(fake.calls[0]?.cwd, '/repo');
  });

  it('fetches the default branch and bases a Run on the remote-tracking ref', async () => {
    const fake = createFakeRunner(ghStub);

    const base = await createGitHubForge({ repoRoot: '/repo', run: fake.runner }).fetchBase();

    assert.equal(base, 'origin/main', 'a Run starts at what the remote holds, not the local branch');
    const fetch = fake.calls[1];
    assert.ok(fetch);
    assert.equal(fetch.command, 'git');
    assert.deepEqual(fetch.args, ['fetch', 'origin', 'main']);
    assert.equal(fetch.cwd, '/repo');
  });

  it('pushes the branch to the remote, and never forces', async () => {
    const fake = createFakeRunner(ghStub);

    await createGitHubForge({ repoRoot: '/repo', run: fake.runner }).pushBranch('orch/spec-1');

    const [push] = fake.calls;
    assert.ok(push);
    assert.equal(push.command, 'git');
    assert.deepEqual(push.args, ['push', '--set-upstream', 'origin', 'orch/spec-1']);
    assert.equal(push.cwd, '/repo');
  });

  it('opens a pull request against the base and reports its number', async () => {
    const fake = createFakeRunner(ghStub);

    const pullRequest = await createGitHubForge({
      repoRoot: '/repo',
      repo: 'o/r',
      run: fake.runner,
    }).openPullRequest({
      branch: 'orch/spec-1',
      base: 'main',
      title: '#1 Spec: unattended delivery',
      body: 'Delivers #1.',
    });

    assert.deepEqual(pullRequest, { number: 42, url: PR_URL });

    const args = fake.calls[0]?.args ?? [];
    assert.deepEqual(args.slice(0, 2), ['pr', 'create']);
    assert.deepEqual(pairsOf(args), {
      '--repo': 'o/r',
      '--base': 'main',
      '--head': 'orch/spec-1',
      '--title': '#1 Spec: unattended delivery',
      '--body': 'Delivers #1.',
    });
    assert.equal(args.includes('--draft'), false, 'a Deliverable is not a draft');
  });

  it('fails loudly when gh prints no pull request url', async () => {
    const fake = createFakeRunner((call) =>
      call.args[0] === 'pr' ? 'something went sideways\n' : ghStub(call),
    );

    await assert.rejects(
      () =>
        createGitHubForge({ repoRoot: '/repo', run: fake.runner }).openPullRequest({
          branch: 'orch/spec-1',
          base: 'main',
          title: 'title',
          body: 'body',
        }),
      /pull request/,
    );
  });
});

function pairsOf(args: readonly string[]): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const [index, arg] of args.entries()) {
    const value = args[index + 1];
    if (arg.startsWith('--') && value !== undefined && !value.startsWith('--')) pairs[arg] = value;
  }
  return pairs;
}
