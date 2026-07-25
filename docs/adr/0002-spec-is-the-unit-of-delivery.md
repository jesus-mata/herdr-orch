---
status: accepted
---

# The Spec is the unit of delivery; Tickets run sequentially within it

A Spec (a PRD's worth of Tickets) maps to exactly one worktree, one branch, one Deliverable.
Specs run concurrently; Tickets inside a Spec run one at a time on the shared branch, each
leaving one commit. We chose this because Specs are guaranteed independent by policy while
Tickets within a Spec are coupled by construction — so the Spec boundary is a dependency
guarantee we get for free, and the Ticket boundary is not.

## Considered options

**Ticket as the unit of delivery — one PR per Ticket.** The original shape. Abandoned once it
was clear that a PRD's Tickets deliver one feature and should be reviewed as one. It also forces
a dependency model between Tickets across PRs, whose only correct resolutions are stacked PRs
(with their squash-merge and cascading-rebase costs) or waiting for a human merge — and waiting
on a merge breaks AFK outright, since merges happen when the human wakes up.

**Parallel Tickets within a Spec.** Explicitly requested, designed, then deferred. Because one
Spec is one branch, parallel Tickets need their own sub-worktrees and must be integrated back:
a single-threaded rebase-and-test queue, plus a conflict-resolution Worker for textual clashes.
Semantic clashes — Ticket 2 renames what Ticket 4 calls, both individually correct, both merging
cleanly — are undetectable at Ticket level and would land on Feature QA. Sequential execution
deletes all of that machinery. Revisit only if wall-clock per Spec becomes the binding
constraint; nothing else in the design depends on Tickets being sequential.

**Inferring a dependency DAG with a planner Worker.** Rejected: it reintroduces model judgment
into the control plane, against ADR-0001. `to-issues` already emits `## Blocked by` and publishes
in topological order, so the ordering is authored by a human upstream and needs no inference.

## Consequences

There is no integration problem, no rebase queue, and no merge-conflict Worker. This is the
single largest simplification in the system and it is load-bearing for several others.

Per-Ticket commits become checkpoints, which the crash-recovery path (reset to the last Ticket
commit, re-run that Ticket) and the Feature QA attribution path (replay each Ticket's Acceptance
suite at HEAD) both depend on.

A Spec that hits a HITL Ticket delivers the prefix before it as a Partial Delivery. This is only
coherent because `to-issues` mandates vertical slices: a prefix of tracer-bullet Tickets is a
narrower working feature, not a half-built one. Against horizontally sliced tickets this whole
decision would be unsound.
