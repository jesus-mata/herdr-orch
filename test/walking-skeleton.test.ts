import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { runBatch } from '../src/orchestrator/batch.ts';
import { createGit } from '../src/git/git.ts';
import type { BatchResult, DeliveredRun, EscalatedRun, RunOutcome } from '../src/domain/outcome.ts';
import { createFakeForge, createFakeTracker, specFixture, ticketFixture } from './helpers/fakes.ts';
import { createScriptedHerdr, type ScriptedHerdr, type ScriptedWorker } from './helpers/scripted-agent.ts';
import { createTempRepo, type TempRepo } from './helpers/temp-repo.ts';

const git = createGit();

const SPEC = specFixture({
  id: '1',
  reference: '#1',
  title: 'Spec: unattended delivery',
  url: 'https://forge.invalid/issues/1',
  tickets: [
    ticketFixture({
      id: '3',
      reference: '#3',
      title: 'Walking skeleton: one Spec, one Ticket',
      url: 'https://forge.invalid/issues/3',
      whatToBuild: 'The full spine at its narrowest, from a Spec to a pull request.',
      acceptanceCriteria: ['Creates a worktree for the Run', 'Opens a pull request'],
    }),
  ],
});

describe('the walking skeleton: one Spec, one Ticket, to a pull request', () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  /** Drives the whole Batch through its single entry point. Nothing else is faked. */
  const drive = async (
    worker: ScriptedWorker,
    specs = [SPEC],
  ): Promise<{
    readonly result: BatchResult;
    readonly herdr: ScriptedHerdr;
    readonly forge: ReturnType<typeof createFakeForge>;
  }> => {
    const herdr = createScriptedHerdr({ repoRoot: repo.path, worker });
    const forge = createFakeForge({ repoRoot: repo.path, defaultBranch: repo.defaultBranch });
    const result = await runBatch({
      tracker: createFakeTracker(specs),
      forge,
      herdr,
      workspaceRoot: repo.workspaceRoot,
      repoRoot: repo.path,
    });
    return { result, herdr, forge };
  };

  const implementsTheTicket: ScriptedWorker = (context) => {
    context.write('src/spine.ts', 'export const spine = true;\n');
  };

  it('drives one Spec to a pull request', async () => {
    const { result, herdr, forge } = await drive(implementsTheTicket);

    const run = expectDelivered(result.runs[0]);

    // The Deliverable, as the Forge recorded it.
    assert.equal(forge.pullRequests.length, 1);
    const pullRequest = forge.pullRequests[0];
    assert.ok(pullRequest);
    assert.equal(pullRequest.base, repo.defaultBranch, 'opened against the default branch');
    assert.equal(pullRequest.branch, run.location.branch);
    assert.match(pullRequest.title, /#1 Spec: unattended delivery/);
    assert.match(pullRequest.body, /#3 — Walking skeleton/);
    assert.equal(run.pullRequest.url, pullRequest.url);

    // The branch was really pushed, at the commit the Run really made.
    assert.deepEqual(
      forge.pushes.map((push) => push.branch),
      [run.location.branch],
    );
    const commit = run.commits[0];
    assert.ok(commit);
    assert.equal(forge.pushes[0]?.commit, commit.commit);
    assert.equal(commit.reference, '#3');

    // The worktree, the branch and the commit, in the real repository.
    assert.equal(run.location.worktreePath, path.join(repo.workspaceRoot, 'spec-1-spec-unattended-delivery'));
    assert.equal(run.location.branch, 'orch/spec-1-spec-unattended-delivery');
    assert.equal(await git.currentBranch(run.location.worktreePath), run.location.branch);
    assert.equal(repo.read('src/spine.ts', run.location.worktreePath), 'export const spine = true;\n');
    assert.equal(
      await repo.git(['show', '--name-only', '--pretty=', commit.commit], run.location.worktreePath),
      'src/spine.ts',
    );
    assert.match(
      await repo.git(['log', '-1', '--pretty=%B', commit.commit], run.location.worktreePath),
      /Walking skeleton: one Spec, one Ticket\n\nTicket: #3/,
    );
    assert.equal(
      await repo.git(['status', '--porcelain'], run.location.worktreePath),
      '',
      'the Run leaves nothing uncommitted behind it',
    );

    // The herdr topology: a worktree-backed workspace, a tab for the Ticket, a
    // prefixed pane, and one fresh Worker in it.
    assert.equal(herdr.workspaces.length, 1);
    const [runWorkspace] = herdr.workspaces;
    assert.ok(runWorkspace);
    assert.equal(runWorkspace.branch, run.location.branch);
    assert.equal(runWorkspace.base, repo.defaultBranch);
    const ticketTab = herdr.tabs.at(-1);
    assert.ok(ticketTab);
    assert.equal(ticketTab.workspaceId, runWorkspace.workspaceId);
    assert.equal(ticketTab.cwd, run.location.worktreePath);
    assert.match(ticketTab.label ?? '', /#3/);

    assert.equal(herdr.agents.length, 1);
    const worker = herdr.agents[0];
    assert.ok(worker);
    assert.equal(worker.kind, 'claude');
    assert.equal(worker.paneId, ticketTab.paneId);
    assert.match(worker.name, /^orch-/, 'a Worker is discoverable by the Orchestrator prefix');
    assert.equal(
      herdr.paneLabels.get(ticketTab.paneId),
      worker.name,
      'the pane carries the same prefixed identifier as the agent',
    );

    // The Ticket, as the Worker was told it.
    assert.equal(herdr.prompts.length, 1);
    const prompt = herdr.prompts[0]?.text ?? '';
    assert.match(prompt, /Ticket #3: Walking skeleton: one Spec, one Ticket/);
    assert.match(prompt, /The full spine at its narrowest/);
    assert.match(prompt, /- Creates a worktree for the Run/);
    assert.match(prompt, /- Opens a pull request/);
    assert.match(prompt, /Do not commit, push, or open a pull request/);
  });

  it('commits work the Worker committed itself, without making a second empty commit', async () => {
    const { result, forge } = await drive(async (context) => {
      context.write('src/spine.ts', 'export const spine = true;\n');
      await context.git(['add', '-A']);
      await context.git(['commit', '--no-verify', '-m', 'the Worker got ahead of itself']);
    });

    const run = expectDelivered(result.runs[0]);
    const commit = run.commits[0];
    assert.ok(commit);
    assert.equal(
      await repo.git(['rev-list', '--count', `${repo.defaultBranch}..HEAD`], run.location.worktreePath),
      '1',
      'the Ticket still leaves exactly one commit',
    );
    assert.equal(forge.pushes[0]?.commit, commit.commit);
  });

  it('escalates when the Worker changed nothing, without opening a pull request', async () => {
    const { result, forge } = await drive(() => {
      // A Worker that refused, crashed, or simply did nothing.
    });

    const run = expectEscalated(result.runs[0]);
    assert.match(run.stoppedAt, /implement/);
    assert.match(run.stoppedAt, /#3/);
    assert.match(run.reason, /nothing/i);
    assert.ok(run.preserved, 'an escalation states what it preserved');
    assert.equal(run.preserved.branch, 'orch/spec-1-spec-unattended-delivery');
    assert.equal(await git.currentBranch(run.preserved.worktreePath), run.preserved.branch);
    assert.equal(forge.pullRequests.length, 0);
    assert.equal(forge.pushes.length, 0);
  });

  it('escalates a Worker that stopped at a prompt rather than committing what it half did', async () => {
    const { result, forge } = await drive((context) => {
      context.write('src/half.ts', 'export const half = true;\n');
      context.settleAs('blocked');
    });

    const run = expectEscalated(result.runs[0]);
    assert.match(run.reason, /blocked|prompt/i);
    assert.equal(forge.pullRequests.length, 0);
    assert.ok(run.preserved, 'the half-done work is preserved for the human');
    assert.equal(repo.exists('src/half.ts', run.preserved.worktreePath), true);
  });

  it('never attempts a HITL Ticket', async () => {
    const spec = specFixture({
      id: '2',
      tickets: [ticketFixture({ id: '20', needsHuman: true })],
    });

    const { result, herdr, forge } = await drive(implementsTheTicket, [spec]);

    const run = expectEscalated(result.runs[0]);
    assert.match(run.reason, /human/i);
    assert.equal(herdr.prompts.length, 0, 'no Worker was started');
    assert.equal(herdr.workspaces.length, 0, 'and no worktree was created');
    assert.equal(forge.pullRequests.length, 0);
  });

  it('escalates a Spec the skeleton cannot yet run, before any Worker starts', async () => {
    const spec = specFixture({
      id: '4',
      tickets: [ticketFixture({ id: '40' }), ticketFixture({ id: '41' })],
    });

    const { result, herdr } = await drive(implementsTheTicket, [spec]);

    const run = expectEscalated(result.runs[0]);
    assert.match(run.stoppedAt, /intake/);
    assert.match(run.reason, /exactly one/);
    assert.equal(herdr.workspaces.length, 0);
    assert.equal(run.preserved, undefined, 'nothing was created, so nothing was preserved');
  });

  it('escalates a Run whose push failed, and still reports its commit', async () => {
    const herdr = createScriptedHerdr({ repoRoot: repo.path, worker: implementsTheTicket });
    const forge = createFakeForge({ repoRoot: repo.path, defaultBranch: repo.defaultBranch });
    forge.failNextPush(new Error('the remote hung up'));

    const result = await runBatch({
      tracker: createFakeTracker([SPEC]),
      forge,
      herdr,
      workspaceRoot: repo.workspaceRoot,
      repoRoot: repo.path,
    });

    const run = expectEscalated(result.runs[0]);
    assert.match(run.stoppedAt, /push/i);
    assert.match(run.reason, /the remote hung up/);
    assert.equal(run.commits.length, 1, 'the commit it did make is still reported');
    assert.equal(forge.pullRequests.length, 0);
  });

  it('lets one Run fail without touching another', async () => {
    const failing = specFixture({ id: '5', tickets: [ticketFixture({ id: '50' })] });
    const succeeding = specFixture({ id: '6', tickets: [ticketFixture({ id: '60' })] });

    const { result, forge } = await drive((context) => {
      if (context.prompt.includes('#50')) context.settleAs('blocked');
      else context.write('src/second.ts', 'export const second = true;\n');
    }, [failing, succeeding]);

    assert.equal(result.runs.length, 2);
    expectEscalated(result.runs[0]);
    const delivered = expectDelivered(result.runs[1]);
    assert.equal(delivered.spec.id, '6');
    assert.equal(forge.pullRequests.length, 1);
    assert.equal(forge.pullRequests[0]?.branch, delivered.location.branch);
  });
});

function expectDelivered(outcome: RunOutcome | undefined): DeliveredRun {
  assert.ok(outcome, 'expected a Run');
  if (outcome.kind !== 'delivered') {
    assert.fail(`expected a Deliverable; escalated at ${outcome.stoppedAt}: ${outcome.reason}`);
  }
  return outcome;
}

function expectEscalated(outcome: RunOutcome | undefined): EscalatedRun {
  assert.ok(outcome, 'expected a Run');
  if (outcome.kind !== 'escalated') assert.fail('expected an Escalation, got a Deliverable');
  return outcome;
}
