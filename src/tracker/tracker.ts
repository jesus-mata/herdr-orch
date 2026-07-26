import type { Spec } from '../domain/spec.ts';

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
   * A Spec whose Tickets cannot be read is refused here, with an `IntakeError`.
   */
  readySpecs(): Promise<readonly Spec[]>;
}
