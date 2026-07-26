import type { Spec } from '../domain/spec.ts';

/**
 * What intake made of one [[Spec]].
 *
 * A refusal is per-Spec on purpose. A Ticket body that does not parse is still an
 * intake failure, loud and before any Worker starts — it just costs that Spec its
 * night rather than the whole [[Batch]]'s, which is what refusing the entire read
 * would cost. [[Run]]s are independent because Specs are, and intake is where that
 * independence is easiest to lose.
 */
export type SpecIntake = ReadySpec | RefusedSpec;

export interface ReadySpec {
  readonly kind: 'ready';
  readonly spec: Spec;
}

/**
 * A [[Spec]] intake will not hand to a Run, and the reason why.
 *
 * It carries the Spec's identity, because the [[Escalation]] it becomes has to name
 * one. It carries no Tickets: the point of the refusal is that they could not all
 * be read, and a half-read list is the thing that reads like a quiet night.
 */
export interface RefusedSpec {
  readonly kind: 'refused';
  readonly spec: Spec;
  readonly reason: string;
  readonly cause: unknown;
}

/**
 * The tracker the work is planned in.
 *
 * Separate from [[Forge]] on purpose: Jira is a tracker with no forge, and one
 * combined interface would force a Jira adapter that throws on pull requests.
 * Jira-planning with GitHub-code is a first-class combination, so the two are
 * configured independently.
 */
export interface Tracker {
  /**
   * The [[Spec]]s their author has marked ready, each with its [[Ticket]]s in the
   * tracker's own order.
   *
   * Order comes from the tracker so that no separate ordered list exists to drift.
   * A Spec whose Tickets cannot be read comes back as a [[RefusedSpec]] rather than
   * as a rejection: it fails intake alone. This rejects only when the backlog
   * itself cannot be read, because then there is no Batch to run at all.
   */
  readySpecs(): Promise<readonly SpecIntake[]>;
}
