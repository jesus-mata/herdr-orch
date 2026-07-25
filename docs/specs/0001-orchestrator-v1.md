# Spec: herdr-orch Orchestrator v1

## Problem Statement

I break features down into a PRD, and the PRD becomes a set of Tickets in a tracker. Working
those Tickets is largely mechanical — read the Ticket, write the code, review it, test it, open
a PR — but it still costs me a full working session per Ticket, and a five-Ticket Spec eats a
week.

Coding agents can do most of that work, but driving them is the problem. I have to sit there:
paste the Ticket in, wait, read what came back, decide whether it's good, ask for fixes, run the
tests, open the PR. The agent does the typing and I do the waiting. Any interruption — a
permission prompt, a failed test, an ambiguous instruction — stops everything until I notice.

What I actually want is to hand over a Spec before I stop for the day and find a reviewable pull
request waiting the next morning. Not a transcript to read, not a half-finished branch, not
twelve panes I have to reconstruct the story from. A PR, and an honest account of anything that
stopped.

The hard part is trust. An unattended system that reports success when it has produced broken
code is worse than no system, because I will merge it. I need to believe the outcome without
re-doing the work, and I need silence to be impossible — every Spec must end in something I can
act on.

## Solution

An Orchestrator that runs unattended and turns each ready Spec into one pull request.

Before I stop for the day I mark Specs ready in the tracker. Overnight, the Orchestrator picks
them up and gives each one its own Git worktree and branch. It works that Spec's Tickets in
order, and for each Ticket it runs a small pipeline of agents in herdr panes: one implements,
one reviews, one fixes what the review found, one confirms the fixes landed, one writes and runs
acceptance tests. Each Ticket becomes one commit. When every Ticket is in, a final Feature QA
pass exercises the assembled feature, and the Orchestrator opens the pull request.

In the morning I read a digest: one line per Run, a link to each pull request, and a plain
statement of anything that stopped and where its work was left. Each Spec's parent Ticket also
carries a comment with the same outcome, so the record lives with the work and my teammates can
see it too.

What makes it trustworthy is that the Orchestrator does not take the agents' word for anything
it can check itself. An agent saying "tests pass" is a claim; the Orchestrator runs the tests
and that is a fact, and where they disagree the fact wins. Acceptance tests that would pass
before the change was made are rejected as worthless. When the final QA pass fails, the
Orchestrator replays each Ticket's acceptance tests to work out which Ticket actually regressed
rather than guessing.

It also refuses work honestly. Reviewers classify each problem they find as in or out of the
Ticket's scope; the agent that does the fixing is only ever shown the in-scope ones, so it
cannot wander into a refactor. Out-of-scope problems that matter become new Tickets in the
tracker. Tickets my breakdown marked as needing a human are never attempted — the Run delivers
everything before them and tells me what decision it needs.

## User Stories

### Getting work into the system

1. As a developer, I want to mark a Spec ready by applying a label to its parent Ticket, so that
   I control exactly what runs unattended and nothing starts without my consent.
2. As a developer, I want the Orchestrator to read Specs from Jira, so that it works with the
   tracker my team already plans in.
3. As a developer, I want the Orchestrator to read Specs from GitHub Issues, so that I can use
   it on personal repos too.
4. As a developer, I want a Spec to be a parent work item and its Tickets to be that item's
   children, so that the structure my breakdown already produces is the structure the
   Orchestrator consumes.
5. As a developer, I want Ticket order to come from the tracker's own ordering, so that I do not
   maintain a separate ordered list that can drift.
6. As a developer, I want the Orchestrator to read a Ticket's prose fields from the issue body
   sections my breakdown already writes, so that the issue template is the only contract I have
   to keep.
7. As a developer, I want parent and dependency relationships read from the tracker's own native
   features where it has them, so that the structure is visible and editable in the tracker's UI
   rather than only inside issue text.
8. As a developer, I want dependency relationships to fall back to a body section on trackers
   without native support, so that the same breakdown works everywhere.
9. As a developer, I want the Orchestrator to check that the Ticket order it was given actually
   respects the dependencies between those Tickets, so that a mis-ordered backlog is caught
   before agents spend a night building on something that does not exist yet.
10. As a developer, I want a Ticket whose body does not parse to fail loudly at intake rather
    than mid-Run, so that malformed work is rejected before any agent starts.
11. As a developer, I want to start a Batch by naming Specs explicitly, so that I can run one
    Spec on demand without waiting for a scheduled sweep.
12. As a developer, I want the Orchestrator to skip Specs it has already delivered, so that
    re-running a Batch does not duplicate work.

### Running a Spec

13. As a developer, I want each Spec to get its own Git worktree and branch, so that concurrent
    Runs never interfere with each other or with my own working tree.
14. As a developer, I want several Specs to run at once, so that a night's capacity is not
    limited to one feature.
15. As a developer, I want Tickets inside a Spec worked one at a time on a single branch, so
    that the Run needs no merge or conflict handling.
16. As a developer, I want each Ticket to produce exactly one commit, so that the pull request
    has a readable history and each Ticket has a checkpoint.
17. As a developer, I want each Phase to run in a fresh agent, so that a Phase never reviews or
    fixes its own output.
18. As a developer, I want to choose the agent and model per Phase, so that I can put reviewing
    on a different model family from implementing and get a genuinely independent opinion.
19. As a developer, I want to set a timeout per Phase, so that a hung agent costs one Phase
    rather than the whole night.
20. As a developer, I want a Worker that becomes blocked on a prompt to be detected rather than
    silently waited on, so that a permission dialog does not consume an entire timeout.

### Knowing whether the work is good

21. As a developer, I want every Phase to report a structured Verdict to a known location, so
    that control flow branches on data rather than on scraped terminal text.
22. As a developer, I want a Phase that finishes without writing a Verdict to be treated as
    failed, so that an agent that crashes or refuses is never mistaken for one that succeeded.
23. As a developer, I want a malformed Verdict to be treated as failed, so that partial or
    invalid output cannot advance a Run.
24. As a developer, I want the Orchestrator to run the tests itself rather than trusting a
    Verdict that says they pass, so that a hallucinated success cannot reach a pull request.
25. As a developer, I want a Verdict contradicted by the Orchestrator's own check to lose, so
    that facts beat claims consistently and predictably.

### Review, scope, and fixing

26. As a developer, I want a reviewing Phase to report each problem as a separate Finding, so
    that each can be routed on its own merits.
27. As a developer, I want each Finding classified as in or out of the Ticket's Scope by the
    reviewer, so that scope is judged by the Phase holding both the Ticket and the diff.
28. As a developer, I want each Finding to carry a priority, so that out-of-scope problems can be
    triaged rather than treated alike.
29. As a developer, I want in-scope Findings fixed by a fresh Remediation agent rather than by
    the agent that wrote the code, so that a bad design is re-read rather than defended.
30. As a developer, I want the Remediation agent to be shown only the in-scope Findings, so that
    it cannot begin a refactor it was never told about.
31. As a developer, I want the Remediation agent to be able to refuse a Finding it discovers to
    be larger than expected, so that a misclassification does not force an out-of-scope change.
32. As a developer, I want out-of-scope, high-priority Findings filed as new Tickets in the
    tracker, so that real problems are refused without being lost.
33. As a developer, I want each new Ticket to record which Run discovered it, so that I can see
    where it came from.
34. As a developer, I want out-of-scope, low-priority Findings written as pull request comments,
    so that nothing an agent noticed is silently discarded.
35. As a developer, I want the original reviewer to confirm whether its Findings were closed, so
    that the judgement is made by the party that knows what it meant.
36. As a developer, I want that confirmation pass to be unable to raise new blocking problems, so
    that the fix loop is guaranteed to terminate rather than finding fault forever.
37. As a developer, I want a cap on fix cycles, so that a Ticket that will not converge escalates
    instead of consuming the night.

### Testing

38. As a developer, I want each Ticket to get acceptance tests written from its stated acceptance
    criteria, so that what is tested is what was asked for.
39. As a developer, I want those tests committed to the branch, so that they ship in the pull
    request and become a permanent regression guard.
40. As a developer, I want a new acceptance test that would already pass before the Ticket's
    change to be rejected, so that tests asserting the implementation back to itself never count
    as verification.
41. As a developer, I want a single Feature QA pass over the assembled feature once every Ticket
    is in, so that interactions between Tickets are exercised.
42. As a developer, I want a failing Feature QA pass to identify which Ticket regressed by
    replaying each Ticket's acceptance tests, so that the fix is targeted rather than guessed at.
43. As a developer, I want an interaction failure that no single Ticket owns to be fixed at Spec
    level, so that genuinely cross-cutting defects still have a path.

### Human decisions and partial delivery

44. As a developer, I want Tickets my breakdown marked as needing a human never to be attempted,
    so that architectural decisions stay mine.
45. As a developer, I want a Run that reaches such a Ticket to deliver every Ticket before it,
    so that a single decision does not waste the whole night's work.
46. As a developer, I want that partial pull request to state which slices it covers, so that I
    review it for what it is rather than mistaking it for the whole feature.
47. As a developer, I want the remaining Tickets picked up by a later Run once I have resolved
    the decision, so that the Spec finishes without being re-planned.
48. As a developer, I want to be told what decision is needed and to have the completed code in
    front of me when I make it, so that I decide with working context rather than in the
    abstract.

### Safety

49. As a developer, I want Workers restricted to an allowlist of ordinary actions, so that an
    unattended agent cannot do arbitrary things to my machine.
50. As a developer, I want dangerous actions hard-denied by policy, so that force-pushes, writes
    to protected branches and access to credential paths are impossible rather than discouraged.
51. As a developer, I want an unrecognised action to escalate the Run rather than be approved,
    so that the safe default is to stop.
52. As a developer, I want every permission decision logged, so that I can audit what the system
    did while I was asleep.
53. As a developer, I want that policy expressed as code I version, so that I can review changes
    to what my agents are allowed to do.

### When things go wrong

54. As a developer, I want the Orchestrator to survive its own crash and resume, so that a
    transient failure does not end the night.
55. As a developer, I want every Worker pane identifiably named, so that agents orphaned by a
    crash can be found and stopped.
56. As a developer, I want orphaned agents killed before any recovery begins, so that a resuming
    Orchestrator and a still-running agent never edit the same worktree.
57. As a developer, I want recovery to reset to the last completed Ticket's commit and re-run
    that Ticket, so that at most one Ticket of work is ever lost and no partial state is guessed
    at.
58. As a developer, I want one Run failing never to affect another, so that a Batch degrades
    rather than collapses.
59. As a developer, I want a Run that cannot proceed to preserve its worktree, branch and logs,
    so that I can pick up where it stopped.

### Finding out what happened

60. As a developer, I want one digest per Batch, so that I can see the whole night at a glance
    rather than opening every Spec.
61. As a developer, I want each Run's outcome commented on its Spec's parent Ticket, so that the
    record lives with the work and my teammates can see it.
62. As a developer, I want an escalation to state exactly where it stopped and what it preserved,
    so that I can act without reconstructing the story.
63. As a developer, I want no notifications fired overnight, so that I am not woken for something
    I cannot act on until morning.
64. As a developer, I want each Phase's terminal output captured to disk before its pane closes,
    so that the forensic record survives herdr's in-memory scrollback.
65. As a developer, I want to watch a Run live in herdr if I happen to be at the machine, so that
    I can see what is happening without disturbing it.

### Extending it

66. As a developer, I want to add a Phase by writing a function, so that new steps like a
    security scan or a documentation pass need no new configuration language.
67. As a developer, I want every Phase's prompt to be editable, so that I can tune behaviour
    without changing the Orchestrator.
68. As a developer, I want the Phases carrying enforced invariants to be distinguishable from
    freely-added ones, so that I do not accidentally weaken a guarantee while customising.

## Implementation Decisions

### Shape

The Orchestrator is a single long-lived TypeScript process on Node LTS, containing no model. See
ADR-0001 for why the control plane is a deterministic program rather than a supervising agent,
and ADR-0003 for why that fixes the implementation language.

It communicates with herdr over the socket API rather than the CLI. The socket is the only place
`events.subscribe` and `events.wait` exist; the CLI offers blocking waits only, and forks a
process per call. The herdr CLI remains the human's tool for inspecting a live Batch.

### Modules

**Herdr client.** Owns the unix socket connection: newline-delimited JSON framing, request/reply
correlation by id, event subscription, and reconnection. Exposes typed wrappers for the methods
in use — worktree creation, tab and pane lifecycle, agent start, agent prompt with wait, pane
read, pane rename, pane close, session snapshot. Two protocol details are load-bearing and
belong here rather than in callers: prompts must wait on both the finished and blocked states,
never the finished state alone, or a Worker stopped at a permission prompt consumes its entire
timeout; and every Worker pane is renamed to a prefixed identifier at creation so orphans are
discoverable after a crash.

**Tracker and Forge.** Two separate interfaces, deliberately not one. Jira is a tracker with no
forge; GitHub is both. A combined interface would force a Jira adapter that throws on pull
request operations. `Tracker` covers listing ready Specs, fetching a Spec's Tickets in order,
resolving the dependency edges between them, commenting, and creating Spawned Tickets. `Forge`
covers branch push, pull request creation, and pull request comments. They are configured
independently, so Jira-planning with GitHub-code is a first-class combination. Adapters for Jira
and GitHub ship in v1.

Dependency resolution is a Tracker responsibility rather than a parsing one, because each
provider expresses it differently and its native representation is better than any text
convention: it is visible and editable in the tracker's own UI, it survives someone rewriting an
issue body, and it can be queried. GitHub has native sub-issues and native issue dependencies;
Jira has issue links. Each adapter satisfies the same interface method using whatever its
provider offers, and falls back to the `Blocked by` body section only where native support is
absent. Callers never learn which mechanism was used.

**Ticket parser.** Provider-agnostic, and the reason the adapters stay thin. It reads the *prose*
fields a Ticket body carries — what to build, acceptance criteria, and the automatability marker
— which are genuinely textual and identical across providers. It does not own structure: parent
and dependency relationships come from the Tracker adapter, per the preceding decision. A body
that does not parse is an intake failure.

**Order validation.** Because Tickets execute sequentially in tracker order, and dependencies are
read separately, the two can disagree — a backlog can be ordered such that a Ticket precedes one
it depends on. Intake checks that the given order is a topological order of the dependency edges
and rejects the Spec if it is not. In v1 this is the only thing dependencies are used for: they
validate ordering rather than drive scheduling, since nothing runs in parallel within a Spec.
Reading them now is nonetheless worth it — it catches a mis-ordered backlog before a night is
spent on it, and it is the input intra-Spec parallelism would need if ADR-0002 is ever revisited.

**Pipeline and Phases.** A Pipeline is a module exporting an ordered array of Phase functions,
each taking a Run context and returning a Verdict. Phases are of two sorts: typed Phases, which
carry invariants the Orchestrator enforces, and generic Phases, which run a prompt and gate on
pass or fail. Adding a step means adding a function. Each Phase declares its agent kind, model
and arguments; the shipped default puts implementing and remediating on one model family and
reviewing and confirming on another, so the checking Phases are decorrelated from the producing
ones. See ADR-0003 for why this is code rather than configuration, and for the enumerated
invariants a future reader must not simplify away.

**Verdict contract.** Each Worker is given a verdict path through its pane environment and
instructed to write structured output there. After a Phase reports finished, the Orchestrator
reads and schema-validates that file. Absence or invalidity is a failed Phase — never an assumed
pass. Verdicts are claims; where a Verdict makes a checkable assertion the Orchestrator performs
the check itself and the check wins.

**Finding router.** Consumes a reviewing Phase's Findings and routes each by scope and priority:
in-scope into the Remediation prompt, out-of-scope and high-priority into a Spawned Ticket,
out-of-scope and low-priority into a pull request comment. The router is the mechanism by which
scope is enforced — the Remediation Worker's prompt is constructed to contain only in-scope
Findings, so exceeding Scope is not something it declines to do but something it cannot know to
attempt. A Remediation Verdict may refuse a Finding, returning it to the deferral path.

**Git operations.** Worktree creation per Run, commit per Ticket, reset to a Ticket commit during
recovery, and checkout of a parent commit for the Vacuity Guard. Real Git throughout; the
Orchestrator shells out rather than reimplementing.

**Run journal.** One durable record per Run holding the Spec, the ordered Tickets, per-Ticket
status, the commit for each completed Ticket, cycle counts, and the terminal outcome. This is
what makes a Run resumable and what recovery reads on boot.

**Recovery.** On boot: enumerate panes by the Orchestrator's naming prefix and close every one,
then for each unfinished Run reset its worktree to the last completed Ticket's commit, clean it,
and re-run that Ticket from the start. No attempt is made to adopt live agents or infer partial
progress. Maximum loss is one Ticket.

**Reporter.** Writes one comment per Run on the Spec's parent Ticket and one digest per Batch.
Nothing is delivered in real time.

### Herdr topology

A Run maps to a worktree-backed workspace, each Ticket to a tab within it, each Phase to a pane
within that tab. When a Ticket completes, its panes' output is captured to disk and its tab
closed, bounding live panes at roughly one Ticket's worth per Run. Herdr's scrollback is
in-memory and cannot serve as the forensic record; the durable sources are captured pane output,
Verdict files, per-Ticket commits, and the journal.

### Pipeline flow

Per Ticket: implement, review, then while blocking Findings remain and the cycle cap is not
reached, remediate and confirm; then acceptance; then commit. Per Spec, once all Tickets are in:
Feature QA, then the pull request. A Ticket marked as needing a human is a hard stop: the Run
performs Feature QA over the completed prefix, opens a pull request stating which slices it
covers, and escalates the decision.

### Permissions

Workers run under an allowlist covering the ordinary loop, with a pre-tool hook applying policy
to everything else: approve known-safe, hard-deny known-dangerous, escalate the Run on anything
unrecognised. Every decision is logged. The policy is versioned code. A worktree is an isolation
mechanism for concurrent Runs, not a security boundary — the hook is the boundary.

### Prerequisite

Herdr's per-agent lifecycle integrations must be installed and current. Without them, agent state
falls back to terminal-buffer detection, where the blocked state is detected only strictly — a
Worker frozen on a permission prompt reads as working. The design assumes reliable blocked
detection.

## Testing Decisions

### What makes a good test here

A good test drives the Orchestrator through its single entry point and asserts on externally
observable results: the state of a real Git repository, the pull requests and comments recorded
by the fake Forge, the Tickets created on the fake Tracker, the Run journal, and the prompt text
sent to Workers. It never asserts that a particular internal function was called, and never
reaches inside a module to inspect state.

The invariants in ADR-0003 are behaviours, not implementation details, and each is expressible as
an external assertion. That is the bar: if an invariant cannot be tested through the entry point,
the seam is in the wrong place.

### The seam

One seam: a batch entry point taking a Tracker, a Forge, a herdr client, and a workspace root.
Everything above that line is real in tests — phase sequencing, Verdict parsing and validation,
Finding routing, scope blinding, the Vacuity Guard, Feature QA attribution, convergence, recovery,
and digest generation.

The herdr client is faked as a **scripted agent**. When the Orchestrator sends a prompt, the fake
performs the side effects a real Worker would, in a real temporary worktree — writing files,
writing the Verdict JSON, making commits — and then reports the finished state. Tests declare
per-Ticket, per-Phase behaviour. No language model is invoked.

Git and the filesystem are real, in per-test temporary repositories. This is deliberate: the
Vacuity Guard, Feature QA attribution and recovery are all defined in terms of Git state, so
faking Git would mean asserting against a fake's behaviour rather than the real invariant.

### Modules tested

The batch entry point is the primary subject and covers everything above the seam. Exactly one
additional, narrower seam is justified: the herdr client tested against a real unix socket with a
stub server, covering framing, partial reads, request correlation and reconnection. The scripted
agent sits above the wire and cannot catch protocol bugs.

The Ticket parser is exercised through intake rather than directly, except for a small table of
malformed bodies asserting that each fails intake with a useful message.

Dependency resolution is tested through the fake Tracker, which exposes edges directly — the
interface is what matters, not which provider mechanism produced them. Each real adapter
additionally gets a narrow test that its native mechanism and its body-section fallback yield the
same edges for an equivalent Spec, since that equivalence is the whole claim the abstraction
makes.

### Representative cases

Each invariant gets at least one test that fails if the invariant is removed:

- A Worker that reports finished without writing a Verdict fails its Phase.
- A Worker that writes a malformed Verdict fails its Phase.
- A Verdict claiming tests pass, against a tree where they do not, fails the Phase.
- An acceptance test that would already pass at the Ticket's parent commit is rejected.
- The Remediation prompt contains the in-scope Findings and does not contain the out-of-scope
  ones.
- An out-of-scope, high-priority Finding produces a Ticket on the fake Tracker; a low-priority
  one produces a pull request comment.
- A reviewer scripted to raise a fresh Finding on every pass still terminates, within the cycle
  cap.
- A confirming pass that notices a new defect does not extend the fix loop.
- A Ticket scripted to break an earlier Ticket's acceptance test is named by Feature QA
  attribution.
- A Spec whose Ticket order contradicts its dependency edges is rejected at intake, before any
  Worker starts.
- A Feature QA failure that no acceptance suite reproduces routes to Spec-level remediation.
- A Spec whose third Ticket needs a human produces a pull request covering the first two and an
  escalation naming the third.
- A crash mid-Ticket, followed by restart, closes orphan panes, resets to the previous Ticket's
  commit, and re-runs the interrupted Ticket.
- One Run failing does not alter another Run's outcome in the same Batch.

### Prior art

None — this is a greenfield repository. These conventions are the prior art for what follows.

## Out of Scope

**Parallel Tickets within a Spec.** Considered and deferred; ADR-0002 records the machinery that
would be needed. Tickets are sequential in v1.

**GitLab adapters.** The Tracker and Forge interfaces are shaped to accept a third provider, but
only Jira and GitHub adapters ship.

**Containerised Workers.** Blast radius is controlled by allowlist and policy hook, not by a
sandbox boundary.

**Real-time alerting.** No Slack, push or email during a Batch.

**A model-driven triage step.** Compatible with the architecture and not built.

**Stacked pull requests, and any cross-Spec dependency handling.** Specs are independent by
policy; if two depended on each other they would be one Spec.

**Multi-repository Specs.** One Spec maps to one repository.

**A user interface beyond herdr and the digest.** No dashboard, no web view.

**Automatic merging.** The Orchestrator opens pull requests and never merges them. Human review
before merge is the point.

## Further Notes

The issue-breakdown convention this consumes mandates vertical slices: each Ticket is a narrow
but complete path through every layer, verifiable on its own. Several decisions depend on that
and would be unsound without it — per-Ticket acceptance testing is meaningful only because a
Ticket is a working thin path, and a partial delivery is a coherent feature of smaller scope only
for the same reason. If Tickets ever become horizontal layer slices, revisit ADR-0002.

Four sizing decisions are deliberately left open, to be set from the first real Batches rather
than guessed: the cap on concurrent Runs, per-Phase timeouts, what triggers a Batch, and where
worktrees live on disk.

Build order should put a walking skeleton first — one Spec, one Ticket, implement only, no
review, through to a pull request. It exercises intake, worktree creation, pane and agent
lifecycle, the Verdict contract, commit and pull request, which is every integration point the
rest of the system layers onto. The invariants are worth nothing until the spine works.

The glossary in `CONTEXT.md` is the vocabulary for this spec and for the code. Terms used here in
their defined sense: Spec, Ticket, HITL Ticket, Partial Delivery, Run, Pipeline, Phase, Worker,
Orchestrator, Verdict, Finding, Scope, Remediation, Verification, Spawned Ticket, Liveness,
Corroboration, Acceptance, Vacuity Guard, Feature QA, Batch, Deliverable, Escalation.
