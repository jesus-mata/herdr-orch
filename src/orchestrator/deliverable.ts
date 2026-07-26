import type { TicketCommit } from '../domain/outcome.ts';
import type { Spec, Ticket } from '../domain/spec.ts';

/** One [[Ticket]], one commit — the checkpoint recovery and attribution both read. */
export function commitMessage(ticket: Ticket): string {
  return `${ticket.title}\n\nTicket: ${ticket.reference}\n${ticket.url}`;
}

export function pullRequestTitle(spec: Spec): string {
  return `${spec.reference} ${spec.title}`;
}

/**
 * The [[Deliverable]]'s description.
 *
 * It states which slices it covers, because a [[Partial Delivery]] and a whole
 * Spec look identical otherwise, and it says plainly that no human has read the
 * code — a reviewer who assumes otherwise is the failure mode this whole system
 * has to avoid.
 */
export function pullRequestBody(spec: Spec, commits: readonly TicketCommit[]): string {
  const covered = spec.tickets
    .filter((ticket) => commits.some((commit) => commit.ticketId === ticket.id))
    .map((ticket) => `- ${ticket.reference} — ${ticket.title}`)
    .join('\n');
  const partial = commits.length < spec.tickets.length;

  return `Delivers ${spec.reference} — ${spec.title}.

${spec.url}

## Tickets covered

${covered}
${partial ? `\nThis covers ${String(commits.length)} of the Spec's ${String(spec.tickets.length)} Tickets.\n` : ''}
Opened by an unattended herdr-orch Run. No human has read this code.`;
}
