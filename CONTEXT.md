# Context

Ubiquitous language for herdr-orch. Glossary only — no implementation details, no decisions
(those live in `docs/adr/`).

## Spec

The set of [[Ticket]]s that together deliver one feature — what a PRD or spec document breaks
down into.

A Spec is the unit of isolation, of concurrency, and of delivery. One Spec is one working tree,
one branch, one [[Deliverable]].

Specs are independent of one another by policy, not by inspection. Because nothing crosses a
Spec boundary, no dependency analysis between Specs is performed — the boundary is the guarantee.
If two Specs ever did depend on each other, they would be one Spec.

## Ticket

A single unit of requested work inside a [[Spec]], as it exists in an external tracker. Canonical
term regardless of provider — a GitHub issue, a Jira issue, and a GitLab work item are all
Tickets here.

A Ticket is a *step*, not a delivery. It has no branch and no [[Deliverable]] of its own; it
contributes commits to its Spec's branch.

A Ticket is owned by the tracker, not by us. We read it and we may comment on it, but the
tracker remains the source of truth for its description and status.

Every Ticket is a *vertical slice*: a narrow but complete path through every layer, verifiable
on its own. This is what makes [[Acceptance]] meaningful at Ticket level and what makes a
[[Partial Delivery]] a coherent artifact rather than a half-built feature.

A Ticket is either AFK or HITL.

## HITL Ticket

A [[Ticket]] its author marked as requiring human interaction — an architectural decision, a
design review. Contrast: an AFK Ticket, which can be delivered without a human.

HITL is declared upstream by whoever broke the [[Spec]] down, not inferred by us. The
[[Orchestrator]] never attempts a HITL Ticket and never second-guesses the marking.

A HITL Ticket is a hard stop in a [[Run]], not a failure. Reaching one is a successful outcome:
the Run delivers everything before it and escalates the decision.

## Partial Delivery

A [[Deliverable]] covering a prefix of its [[Spec]]'s [[Ticket]]s rather than all of them —
produced when a [[Run]] halts at a [[HITL Ticket]].

A Partial Delivery is mergeable, not provisional. Because Tickets are vertical slices, a prefix
of them is a working feature of smaller scope, and it is reviewed and merged on its own terms.

The remaining Tickets are picked up by a later [[Run]] once the human has resolved the HITL
Ticket. The Spec is not "half done"; it has delivered some of its slices.

## Run

One [[Spec]]'s single journey from picked-up to human-reviewable [[Deliverable]].

A Run works its Tickets in order, one at a time, on a single branch — so no two Workers ever
write to the same tree, and integration between Tickets is not a problem the Orchestrator has.

A Run outlives the process that started it: it records progress per Ticket and resumes at the
Ticket it failed on rather than from the beginning.

One Spec may have more than one Run over time (a retry, a re-open), but only one live Run at
a time.

## Pipeline

The ordered sequence of [[Phase]]s a [[Run]] passes through, expressed as code — a module
exporting an array of Phase functions.

Deliberately not a configuration format. Several Phases carry non-negotiable invariants
(convergence in [[Verification]], the [[Vacuity Guard]], blinding in [[Remediation]]) that a
declarative schema would either fail to express or silently let a user break. Code keeps them
type-checked and enforceable.

The Pipeline is a template. A Run is an instance of it.

## Phase

One named step in a [[Pipeline]] — a function taking a Run's context and returning a [[Verdict]].

A Phase is a *specification*. The [[Worker]] is the thing that actually executes it.

Phases are of two sorts. *Typed* Phases (implement, review, remediate, verify, acceptance,
feature-qa) carry semantics the [[Orchestrator]] knows about and enforces. *Generic* Phases run
a prompt and gate on pass/fail with no special routing — this is where new steps are added.

Each Phase runs in a fresh [[Worker]]. This is an invariant, not an optimisation: a Phase that
reviewed or remediated its own prior output would defeat the point of being a separate Phase.

## Worker

One agent process (Claude, Codex) executing one [[Phase]] of one [[Run]], inside one herdr pane.

A Worker is disposable and single-purpose. It has no memory of other Phases beyond what its
prompt was given, and it does not decide what runs next — that is the [[Orchestrator]]'s job.

Contrast with [[Orchestrator]]: a Worker exercises judgment about code; it exercises no judgment
about control flow.

## Orchestrator

The single long-lived process that owns every [[Run]]'s state and decides what executes next.

The Orchestrator is *not* an agent and contains no model. This is deliberate: control flow here
requires reliability across many hours, not judgment.

Note: in early discussion "orchestrator" was also used for a Claude instance supervising other
Claude instances. That usage is retired. A model-driven supervisor, if one ever exists, is a
[[Worker]].

## Verdict

A [[Worker]]'s structured, machine-readable report of the outcome of its [[Phase]].

A Verdict is a *claim*, not a fact. It is what the Worker asserts happened.

Absence of a Verdict is a failed Phase, never an assumed pass.

Contrast with [[Liveness]]: a Verdict says what the Worker concluded; Liveness says only
whether it is still talking.

## Finding

One defect a reviewing [[Worker]] reports inside its [[Verdict]]. Carries, at minimum, its
[[Scope]] and its priority.

A Finding is classified at the moment it is found, by the Worker that found it, because that
Worker is the one holding both the [[Ticket]] and the diff. Classification is not revisited
downstream.

Every Finding is routed somewhere. A Finding is never silently dropped.

## Scope

The boundary of what a [[Ticket]] asked for. A [[Finding]] is *in scope* when fixing it is part
of delivering that Ticket, and *out of scope* when fixing it would mean a major refactor, an
architectural change, or a change to business logic the Ticket did not ask about.

Scope is a semantic judgment, not a measure of diff size. A one-line change to business logic
is out of scope; a hundred-line change confined to the feature being built is in scope.

Scope is enforced by *withholding*, not by instruction: a [[Remediation]] Worker is shown only
in-scope Findings, so exceeding Scope is not something it can decline to do — it is something
it cannot know to attempt.

## Remediation

The [[Phase]] that fixes in-scope [[Finding]]s from a rejected review.

Remediation runs in a fresh [[Worker]], never the one that wrote the original code. The
implementing Worker is anchored on its own design; a new Worker reads what is actually there.

A Remediation Worker may refuse a Finding it discovers to be out of [[Scope]] after all. Refusal
is a legitimate outcome and returns that Finding to the deferral path — it is not a failure.

## Verification

The bounded second look that closes a [[Remediation]] cycle: given the [[Finding]]s that were
sent for fixing, confirm which are now closed.

Verification is performed by the same [[Worker]] that authored the Findings, because it is the
only party that knows what it meant.

Verification answers a fixed question about a known list. It is not a review, and it may not
extend the list — defects it notices in passing become [[Spawned Ticket]]s or PR comments, never
another cycle. This is what makes the loop terminate: the Finding list can only shrink.

## Spawned Ticket

A new [[Ticket]] the [[Orchestrator]] files in the tracker for an out-of-[[Scope]], high-priority
[[Finding]].

Spawned Tickets are how the system refuses work without losing it. They are created by the
Orchestrator, never by a [[Worker]] — the Orchestrator is the single writer to the tracker, so
it alone can deduplicate and attribute them.

A Spawned Ticket records which [[Run]] discovered it.

## Liveness

Herdr's own observation of whether a pane's agent is idle, working, blocked, or done.

Liveness is supplied by herdr and is about the *process*. It carries no information about
outcome — a Worker that crashed, refused the task, or hallucinated success all reach `done`.

Never read `done` as success. Success is a [[Verdict]] plus [[Corroboration]].

## Corroboration

An objective check the [[Orchestrator]] performs itself to confirm a [[Verdict]]'s checkable claims
— running the tests, reading the commit log.

Corroboration produces facts. Where a fact contradicts a [[Verdict]], the fact wins.

Only some claims are corroborable. "Tests pass" is. "This design is clean" is not.

## Acceptance

[[Ticket]]-level QA: does this one Ticket do what it said it would?

Acceptance is scoped to a single Ticket's acceptance criteria and runs immediately after that
Ticket's review closes, while the change is small and its author's intent is still recoverable.

Acceptance produces *committed, executable tests*, not an opinion. This is not a stylistic
preference — [[Feature QA]] attributes regressions by replaying Acceptance suites, so an
Acceptance that leaves no runnable artifact silently breaks attribution for the whole [[Run]].

Every Acceptance suite is a permanent regression guard, and must survive the [[Vacuity Guard]]
before it counts.

Acceptance cannot see the future. It says nothing about whether a later Ticket will break this
one — that is [[Feature QA]]'s question.

## Vacuity Guard

The check that a newly written [[Acceptance]] test actually exercises new behaviour: it must
pass at the [[Ticket]]'s commit and *fail* at its parent.

A test written after reading the implementation tends to assert what the code does rather than
what the [[Ticket]] asked for. Such a test passes forever and detects nothing. The Vacuity Guard
is what distinguishes a regression guard from a tautology.

It is a form of [[Corroboration]]: pure mechanics, no judgment — run the test twice, at two
commits. A test that passes at the parent means Acceptance failed, not that the code is fine.

## Feature QA

[[Spec]]-level QA: does the assembled feature work, end to end, once every [[Ticket]] is in?

Feature QA exists because [[Acceptance]] is structurally blind to interaction. Ticket 4 can pass
its own Acceptance and still break Ticket 2 — nothing at Ticket level is looking at that.
Feature QA is the only Phase that sees the whole [[Deliverable]] at once.

Feature QA is therefore about regression and integration, not about re-checking each Ticket.

## Batch

The set of [[Run]]s the [[Orchestrator]] executes in one unattended session.

Runs within a Batch are independent, because [[Spec]]s are. One Run escalating never affects
another; a Batch has no all-or-nothing outcome.

A Batch's result is read the next morning, as a whole. This is why no outcome is delivered in
real time: there is no one awake to act on it.

## Deliverable

The reviewable artifact a [[Run]] hands to the human — the pull request or merge request.

The Deliverable is the *only* intended human touchpoint of a successful Run. Anything that
requires a human before this point is an [[Escalation]].

A Deliverable may cover the whole [[Spec]] or only a prefix of it (see [[Partial Delivery]]).
Both are complete, mergeable artifacts; neither is a draft.

## Escalation

A [[Run]] surfaced to the human because the [[Orchestrator]] cannot proceed, or because it
reached a [[HITL Ticket]].

An Escalation is a Run that stopped, not a Run that failed quietly. Silence is never an
acceptable outcome — an unattended Run must end in a [[Deliverable]], an Escalation, or both.

An Escalation always states where it stopped and what it preserved. A Run that stops without
leaving the human enough to act on has not escalated; it has just failed.
