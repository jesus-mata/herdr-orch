import type { Spec } from './spec.ts';

/** The [[Deliverable]]: the reviewable artifact a [[Run]] hands to the human. */
export interface PullRequest {
  readonly number: number;
  readonly url: string;
}

/** One [[Ticket]]'s commit. Per ADR-0002 a Ticket leaves exactly one. */
export interface TicketCommit {
  readonly ticketId: string;
  readonly reference: string;
  readonly commit: string;
}

/** Where a [[Run]]'s work lives on disk, so a human can pick it up. */
export interface RunLocation {
  readonly branch: string;
  readonly worktreePath: string;
}

/**
 * How a [[Run]] ended.
 *
 * There are two endings and no third: a [[Deliverable]], or an [[Escalation]].
 * Silence is not an outcome — an unattended Run that stops without leaving the
 * human something to act on has not escalated, it has failed.
 */
export type RunOutcome = DeliveredRun | EscalatedRun;

export interface DeliveredRun {
  readonly kind: 'delivered';
  readonly spec: Spec;
  readonly location: RunLocation;
  readonly commits: readonly TicketCommit[];
  readonly pullRequest: PullRequest;
}

/**
 * A Run surfaced to the human because it could not proceed.
 *
 * `stoppedAt` and `preserved` are the whole point: an Escalation that does not say
 * where it stopped and what it left behind is not actionable in the morning.
 */
export interface EscalatedRun {
  readonly kind: 'escalated';
  readonly spec: Spec;
  /** Where it stopped, in the Orchestrator's own terms. */
  readonly stoppedAt: string;
  readonly reason: string;
  /** Undefined only when it stopped before a worktree existed. */
  readonly preserved: RunLocation | undefined;
  readonly commits: readonly TicketCommit[];
  /** The failure behind it, where there was one. For the log, not for branching. */
  readonly cause: unknown;
}

/** The set of [[Run]]s the Orchestrator executed in one unattended session. */
export interface BatchResult {
  readonly runs: readonly RunOutcome[];
}
