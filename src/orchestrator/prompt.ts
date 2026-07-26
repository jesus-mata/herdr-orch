import type { Spec, Ticket } from '../domain/spec.ts';

/**
 * What the implementing [[Worker]] is told.
 *
 * Two properties matter more than the wording. It carries the [[Ticket]]'s own
 * prose rather than a summary, because the tracker is the source of truth and a
 * paraphrase drifts from it. And it withholds the delivery steps: the Worker does
 * not commit, push or open the pull request, because those are the Orchestrator's
 * to do — it is the only party that can be trusted to do them once.
 */
export function implementPrompt(spec: Spec, ticket: Ticket): string {
  const criteria = ticket.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n');

  return `You are implementing one Ticket of the Spec ${spec.reference} — ${spec.title}.

Ticket ${ticket.reference}: ${ticket.title}
${ticket.url}

## What to build

${ticket.whatToBuild}

## Acceptance criteria

${criteria}

## How this Ticket is delivered

You are working in a Git worktree prepared for this Ticket, on its own branch. It
is yours alone; nothing else is writing to it.

Implement what the Ticket asks for, and leave the work in the working tree.

- Do not commit, push, or open a pull request. The Orchestrator commits what you
  produced when you finish, and opens the pull request itself.
- Do not switch, create or delete branches, and do not touch any other worktree.
- Stay inside the Ticket. Anything you notice that is outside what this Ticket
  asked for is not yours to fix — say so in your final message instead.

No one is watching this run. If you cannot proceed, stop and say why in your final
message rather than guessing.`;
}
