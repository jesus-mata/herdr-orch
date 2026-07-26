/**
 * A single unit of requested work inside a [[Spec]], as the Orchestrator holds it.
 *
 * A Ticket is owned by the tracker. This is a read of it, taken at intake and not
 * refreshed: a Run that re-read its Tickets halfway through could change what it
 * was building under itself.
 */
export interface Ticket {
  /** The provider's own identifier, used to talk to the tracker. */
  readonly id: string;
  /** How a human refers to it — `#3`, `PROJ-14`. Appears in prompts and commits. */
  readonly reference: string;
  readonly title: string;
  readonly url: string;
  readonly whatToBuild: string;
  readonly acceptanceCriteria: readonly string[];
  /**
   * A [[HITL Ticket]]: its author marked it as needing a human. Declared upstream,
   * never inferred here, and never attempted.
   */
  readonly needsHuman: boolean;
}

/**
 * The set of [[Ticket]]s that together deliver one feature.
 *
 * One Spec is one worktree, one branch, one [[Deliverable]]. Its Tickets are in
 * the tracker's own order, which is the order they will be worked in.
 */
export interface Spec {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly url: string;
  readonly tickets: readonly Ticket[];
}
