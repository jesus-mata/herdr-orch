import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IntakeError } from '../src/domain/errors.ts';
import { parseTicketBody } from '../src/tracker/ticket-body.ts';

const WELL_FORMED = `## Parent

#1

## What to build

The full spine at its narrowest. Given a Spec labelled ready-for-agent, the
Orchestrator opens a pull request.

No review, no QA.

## Acceptance criteria

- [ ] Reads a Spec and its single Ticket
- [x] Creates a Git worktree and branch for the Run
- [ ] Opens a pull request against the default branch

## Blocked by

- #2
`;

describe('the Ticket parser', () => {
  it('reads the prose fields and ignores the structural sections', () => {
    const body = parseTicketBody(WELL_FORMED, '#3');

    assert.equal(
      body.whatToBuild,
      'The full spine at its narrowest. Given a Spec labelled ready-for-agent, the\n' +
        'Orchestrator opens a pull request.\n' +
        '\n' +
        'No review, no QA.',
    );
    assert.deepEqual(body.acceptanceCriteria, [
      'Reads a Spec and its single Ticket',
      'Creates a Git worktree and branch for the Run',
      'Opens a pull request against the default branch',
    ]);
  });

  it('does not care about heading case or depth', () => {
    const body = parseTicketBody(
      '### WHAT TO BUILD\n\nA thing.\n\n### acceptance Criteria\n\n* [ ] It works\n',
      '#7',
    );

    assert.equal(body.whatToBuild, 'A thing.');
    assert.deepEqual(body.acceptanceCriteria, ['It works']);
  });

  it('reads a heading inside a fenced code block as prose, not as a section', () => {
    const body = parseTicketBody(
      [
        '## What to build',
        '',
        'Add the section to the README:',
        '',
        '```md',
        '## Acceptance criteria',
        '',
        '- placeholder from the example',
        '```',
        '',
        'Then wire it up to the parser.',
        '',
        '## Acceptance criteria',
        '',
        '- The README renders',
      ].join('\n'),
      '#7',
    );

    assert.match(
      body.whatToBuild,
      /Then wire it up to the parser\.$/,
      'the fence does not cut the prose short',
    );
    assert.deepEqual(
      body.acceptanceCriteria,
      ['The README renders'],
      'and a bullet inside the fence is a code sample, not a criterion',
    );
  });

  it('closes a fence opened with tildes', () => {
    const body = parseTicketBody(
      '## What to build\n\n~~~\n## Not a heading\n~~~\n\nReal prose.\n\n## Acceptance criteria\n\n- It works\n',
      '#7',
    );

    assert.match(body.whatToBuild, /Real prose\./);
    assert.deepEqual(body.acceptanceCriteria, ['It works']);
  });

  it('accepts plain bullets as criteria', () => {
    const body = parseTicketBody('## What to build\n\nA thing.\n\n## Acceptance criteria\n\n- It works\n', '#7');

    assert.deepEqual(body.acceptanceCriteria, ['It works']);
  });

  const malformed: readonly { readonly name: string; readonly body: string; readonly message: RegExp }[] = [
    {
      name: 'an empty body',
      body: '',
      message: /#9.*What to build/s,
    },
    {
      name: 'a body with no What to build section',
      body: '## Acceptance criteria\n\n- [ ] It works\n',
      message: /#9.*What to build/s,
    },
    {
      name: 'a body with no Acceptance criteria section',
      body: '## What to build\n\nA thing.\n',
      message: /#9.*Acceptance criteria/s,
    },
    {
      name: 'an empty What to build section',
      body: '## What to build\n\n## Acceptance criteria\n\n- [ ] It works\n',
      message: /#9.*What to build.*empty/s,
    },
    {
      name: 'an Acceptance criteria section with no items',
      body: '## What to build\n\nA thing.\n\n## Acceptance criteria\n\nIt should be good.\n',
      message: /#9.*Acceptance criteria.*no items/s,
    },
  ];

  for (const { name, body, message } of malformed) {
    it(`fails intake on ${name}`, () => {
      assert.throws(() => parseTicketBody(body, '#9'), (error: unknown) => {
        assert.ok(error instanceof IntakeError, `expected an IntakeError, got ${String(error)}`);
        assert.match(error.message, message);
        return true;
      });
    });
  }
});
