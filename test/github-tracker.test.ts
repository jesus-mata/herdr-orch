import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Spec } from '../src/domain/spec.ts';
import { createGitHubTracker } from '../src/tracker/github-tracker.ts';
import type { RefusedSpec, SpecIntake } from '../src/tracker/tracker.ts';
import { createFakeRunner, type RecordedCommand } from './helpers/fake-runner.ts';

const TICKET_BODY = `## Parent

#1

## What to build

The full spine at its narrowest.

## Acceptance criteria

- [ ] Reads a Spec
- [ ] Opens a pull request
`;

interface Issue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly state: string;
  readonly subIssues: number;
  readonly isPullRequest: boolean;
}

function issue(overrides: Partial<Issue> & Pick<Issue, 'number'>): Issue {
  return {
    title: `Issue ${String(overrides.number)}`,
    url: `https://github.com/o/r/issues/${String(overrides.number)}`,
    body: TICKET_BODY,
    labels: ['ready-for-agent'],
    state: 'open',
    subIssues: 0,
    isPullRequest: false,
    ...overrides,
  };
}

/** Answers the two `gh api` calls the adapter makes, and nothing else. */
function ghStub(options: {
  readonly labelled: readonly Issue[];
  readonly children: Readonly<Record<string, readonly Issue[]>>;
}): (call: RecordedCommand) => string | Error {
  return (call) => {
    const target = call.args.find((arg) => arg.startsWith('repos/'));
    if (target === undefined) return new Error(`unexpected call: ${call.args.join(' ')}`);
    const childrenOf = /^repos\/o\/r\/issues\/(\d+)\/sub_issues$/.exec(target);
    if (childrenOf?.[1] !== undefined) {
      return JSON.stringify(options.children[childrenOf[1]] ?? []);
    }
    if (target === 'repos/o/r/issues') return JSON.stringify(options.labelled);
    return new Error(`unexpected endpoint: ${target}`);
  };
}

function expectReady(intake: SpecIntake | undefined): Spec {
  assert.ok(intake, 'expected an intake');
  if (intake.kind !== 'ready') assert.fail(`expected a ready Spec; it was refused: ${intake.reason}`);
  return intake.spec;
}

function expectRefused(intake: SpecIntake | undefined): RefusedSpec {
  assert.ok(intake, 'expected an intake');
  if (intake.kind !== 'refused') assert.fail('expected a refusal, got a ready Spec');
  return intake;
}

describe('the GitHub Tracker adapter', () => {
  it('reads ready Specs and their Tickets in the tracker\'s order', async () => {
    const fake = createFakeRunner(
      ghStub({
        labelled: [
          issue({ number: 9, title: 'Spec: later', subIssues: 1 }),
          issue({ number: 1, title: 'Spec: orchestrator v1', subIssues: 3 }),
        ],
        children: {
          '1': [
            issue({ number: 2, title: 'Herdr socket client', state: 'closed' }),
            issue({ number: 3, title: 'Walking skeleton' }),
            issue({ number: 4, title: 'Verdict contract', labels: ['ready-for-human'] }),
          ],
          '9': [issue({ number: 10, title: 'Something else' })],
        },
      }),
    );

    const specs = await createGitHubTracker({
      repo: 'o/r',
      cwd: '/repo',
      run: fake.runner,
    }).readySpecs();

    assert.deepEqual(
      specs.map((intake) => intake.spec.reference),
      ['#1', '#9'],
      'Specs come back in issue order, not the API\'s newest-first',
    );

    const spec = expectReady(specs[0]);
    assert.equal(spec.id, '1');
    assert.equal(spec.title, 'Spec: orchestrator v1');
    assert.equal(spec.url, 'https://github.com/o/r/issues/1');

    assert.deepEqual(
      spec.tickets.map((ticket) => ticket.reference),
      ['#3', '#4'],
      'a closed Ticket is already delivered and is not re-run',
    );

    const ticket = spec.tickets[0];
    assert.ok(ticket);
    assert.equal(ticket.id, '3');
    assert.equal(ticket.title, 'Walking skeleton');
    assert.equal(ticket.whatToBuild, 'The full spine at its narrowest.');
    assert.deepEqual(ticket.acceptanceCriteria, ['Reads a Spec', 'Opens a pull request']);
    assert.equal(ticket.needsHuman, false);
    assert.equal(spec.tickets[1]?.needsHuman, true, 'the human label makes it a HITL Ticket');
  });

  it('asks GitHub for open issues carrying the ready label', async () => {
    const fake = createFakeRunner(ghStub({ labelled: [], children: {} }));

    await createGitHubTracker({ repo: 'o/r', cwd: '/repo', run: fake.runner }).readySpecs();

    const argv = fake.argv()[0] ?? '';
    assert.match(argv, /^gh api repos\/o\/r\/issues /);
    assert.match(argv, /labels=ready-for-agent/);
    assert.match(argv, /state=open/);
    assert.equal(fake.calls[0]?.cwd, '/repo');
  });

  it('treats a labelled issue with no sub-issues as a Ticket, not a Spec', async () => {
    const fake = createFakeRunner(
      ghStub({ labelled: [issue({ number: 3, subIssues: 0 })], children: {} }),
    );

    const specs = await createGitHubTracker({
      repo: 'o/r',
      cwd: '/repo',
      run: fake.runner,
    }).readySpecs();

    assert.deepEqual(specs, []);
    assert.equal(fake.calls.length, 1, 'and does not go looking for its children');
  });

  it('ignores a pull request that happens to carry the label', async () => {
    const fake = createFakeRunner(
      ghStub({
        labelled: [issue({ number: 5, subIssues: 2, isPullRequest: true })],
        children: {},
      }),
    );

    const specs = await createGitHubTracker({
      repo: 'o/r',
      cwd: '/repo',
      run: fake.runner,
    }).readySpecs();

    assert.deepEqual(specs, []);
  });

  it('refuses the Spec whose Ticket body does not parse, and no other', async () => {
    const fake = createFakeRunner(
      ghStub({
        labelled: [issue({ number: 1, subIssues: 1 }), issue({ number: 2, subIssues: 1 })],
        children: {
          '1': [issue({ number: 3, body: 'Just some prose.' })],
          '2': [issue({ number: 4 })],
        },
      }),
    );

    const specs = await createGitHubTracker({
      repo: 'o/r',
      cwd: '/repo',
      run: fake.runner,
    }).readySpecs();

    const refused = expectRefused(specs[0]);
    assert.equal(refused.spec.reference, '#1');
    assert.match(refused.reason, /#3/, 'the refusal names the Ticket it could not read');
    assert.deepEqual(refused.spec.tickets, [], 'a refusal carries no half-read Ticket list');

    const readable = expectReady(specs[1]);
    assert.equal(readable.reference, '#2');
    assert.deepEqual(
      readable.tickets.map((ticket) => ticket.reference),
      ['#4'],
      'one Spec\'s malformed Ticket does not cost another its night',
    );
  });

  it('refuses a Spec whose children could not be fetched at all', async () => {
    const fake = createFakeRunner((call) => {
      if (call.args.includes('repos/o/r/issues/1/sub_issues')) return new Error('gh: 502');
      return ghStub({ labelled: [issue({ number: 1, subIssues: 1 })], children: {} })(call);
    });

    const specs = await createGitHubTracker({
      repo: 'o/r',
      cwd: '/repo',
      run: fake.runner,
    }).readySpecs();

    assert.match(expectRefused(specs[0]).reason, /502/);
  });

  it('refuses to work from a page that came back full', async () => {
    const labelled = Array.from({ length: 100 }, (_, index) =>
      issue({ number: index + 1, subIssues: 1 }),
    );
    const fake = createFakeRunner(ghStub({ labelled, children: {} }));

    await assert.rejects(
      () => createGitHubTracker({ repo: 'o/r', cwd: '/repo', run: fake.runner }).readySpecs(),
      /page of 100/,
      'reading only the first hundred would leave Specs unread and unreported',
    );
  });

  it('resolves the repository from the working directory when it is not given', async () => {
    const fake = createFakeRunner((call) => {
      if (call.args[0] === 'repo') return 'o/r\n';
      return ghStub({ labelled: [], children: {} })(call);
    });

    await createGitHubTracker({ cwd: '/repo', run: fake.runner }).readySpecs();

    assert.match(fake.argv()[0] ?? '', /^gh repo view .*nameWithOwner/);
    assert.match(fake.argv()[1] ?? '', /^gh api repos\/o\/r\/issues /);
  });

  it('rejects output that is not the shape gh promised', async () => {
    const fake = createFakeRunner(() => '{"not": "an array"}');

    await assert.rejects(
      () => createGitHubTracker({ repo: 'o/r', cwd: '/repo', run: fake.runner }).readySpecs(),
      /gh/,
    );
  });
});
