/**
 * A Spec was rejected before any Worker started.
 *
 * Intake is the only place work is refused cheaply. A Ticket whose body does not
 * parse, an order that contradicts its dependencies, a Spec shaped in a way the
 * Orchestrator cannot run — all of them fail here, loudly, rather than halfway
 * through a night.
 */
export class IntakeError extends Error {
  override readonly name = 'IntakeError';
}
