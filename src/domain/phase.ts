/**
 * One named step in a [[Pipeline]].
 *
 * A union rather than a string: a Phase name reaches pane labels, worker names and
 * escalation messages, and a typo in any of those is a Run a human cannot find
 * afterwards. Later Phases (review, remediate, verify, acceptance, feature-qa)
 * extend this union as they arrive.
 */
export type PhaseName = 'implement';

export const IMPLEMENT: PhaseName = 'implement';
