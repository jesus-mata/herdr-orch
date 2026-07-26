import type { PhaseName } from '../domain/phase.ts';
import type { Spec, Ticket } from '../domain/spec.ts';

/**
 * The prefix every artifact the Orchestrator creates carries.
 *
 * Load-bearing, not cosmetic: recovery finds the [[Worker]]s a crash orphaned by
 * enumerating panes whose label starts with this and closing them. A Worker pane
 * without it is a pane a resuming Orchestrator cannot see, still holding a
 * worktree it is about to reset.
 */
export const ORCH_PREFIX = 'orch';

/** How long a generated slug may get before it stops being readable. */
const SLUG_LIMIT = 48;

/** One branch per [[Run]], per ADR-0002. */
export function branchFor(spec: Spec): string {
  return `${ORCH_PREFIX}/${specSlug(spec)}`;
}

/** The directory name under the workspace root holding this Run's worktree. */
export function worktreeDirName(spec: Spec): string {
  return specSlug(spec);
}

/**
 * The identifier a [[Worker]]'s pane and agent both carry.
 *
 * One string for both so that a pane found by its label and an agent found by its
 * name are recognisably the same Worker.
 */
export function workerIdentity(spec: Spec, ticket: Ticket, phase: PhaseName): string {
  return [ORCH_PREFIX, slug(spec.id), slug(ticket.id), phase].join('-');
}

export function workspaceLabel(spec: Spec): string {
  return `${ORCH_PREFIX} ${spec.reference} ${spec.title}`;
}

export function tabLabel(ticket: Ticket): string {
  return `${ticket.reference} ${ticket.title}`;
}

function specSlug(spec: Spec): string {
  return `spec-${slug(spec.id)}-${slug(spec.title, SLUG_LIMIT)}`;
}

/**
 * Lowercase, alphanumerics and single dashes. Nothing else survives, which is what
 * makes the result safe as a branch name, a directory name and a herdr label at
 * once rather than safe in one of the three.
 */
export function slug(text: string, limit = SLUG_LIMIT): string {
  const slugged = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slugged.slice(0, limit).replace(/-+$/g, '') || 'unnamed';
}
