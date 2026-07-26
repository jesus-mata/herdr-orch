---
status: accepted
---

# The Orchestrator is a deterministic program, not an agent

Herdr makes it trivial to have one Claude pane spawn and supervise others, and that was this
project's original design. We rejected it: the Orchestrator is a hand-written TypeScript daemon
holding a persistent connection to the herdr socket API, and Claude/Codex appear only as Workers
executing a single Phase inside a pane. The control logic here — fetch Specs, run Tickets in
order, route Findings, open a PR — requires no judgment; it requires reliability across an
unattended eight-hour Batch, which is the one thing a model in a control loop cannot offer.

## Considered options

**Claude pane as Orchestrator, driving the herdr CLI.** The obvious design, and the easiest to
prototype — you can watch it reason. Rejected on four counts. Its state lives in a context
window, so a long Batch exhausts or compacts it and the run is lost. It burns tokens on every
state transition, including while merely waiting. It drifts: a state machine executed by a model
is a state machine that will eventually improvise. And the CLI has no event subscription, so it
must block on one `agent wait` at a time — awkward for parallel Runs.

**Hybrid: deterministic happy path, LLM triage on failure.** Genuinely attractive, and still
compatible with this decision — a triage Worker is just a Worker. Deferred rather than rejected.
Nothing here forecloses it.

## Consequences

The socket API is mandatory, not a preference. `events.subscribe` and `events.wait` exist only
there; the CLI's only reactive primitives are blocking waits, and every CLI call forks a process
and opens a new connection. The CLI remains the human's tool for inspecting a live Batch.

The "persistent connection" above turned out not to be available: herdr answers one request per
connection. See ADR-0004, which amends this paragraph and leaves the rest of this decision intact.

Because the Orchestrator has no model, every judgment must be pushed into a Phase and returned
as a structured Verdict (see `CONTEXT.md`). Control flow can only branch on machine-readable
data, never on "what the agent seemed to mean." This is a real constraint on prompt design, and
it is the point.
