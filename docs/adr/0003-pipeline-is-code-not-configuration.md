---
status: accepted
---

# The Pipeline is TypeScript, not a configuration format

Pipelines are modules exporting an ordered array of Phase functions, each taking a Run context
and returning a Verdict. Adding a step means writing a function; customising a prompt means
editing code. We chose this over the conventional YAML workflow definition because several
Phases carry invariants that a declarative schema would either fail to express or silently let
a user break — and because the customisation surface is a single developer, not a team of
non-programmers.

## Considered options

**Declarative YAML with typed phase kinds plus a `generic` escape hatch.** The intuitive answer,
and the one initially recommended: known kinds carry built-in semantics, `kind: generic` runs a
prompt for user-added steps. Rejected in favour of code, which gives the same extensibility with
type-checking and no DSL to design, document, or version.

**Fully generic phases with declarative routing rules.** A real workflow engine — every Phase
declares its prompt, Verdict schema, and `on_fail: goto` edges. Rejected as scope: it is a
second product, and the Vacuity Guard and Feature QA attribution still require native hooks, so
the special machinery leaks in as privileged config keys regardless.

## Consequences

Phases execute in-process, so this decision also fixes the Orchestrator's implementation
language: TypeScript on a JavaScript runtime. A Python or Go daemon could not call a Pipeline
module. The runtime is Node LTS — the daemon holds a socket open unattended for hours, which is
where the boring, best-supported option wins; Bun's faster startup and single-binary compile buy
little for a process started once a day, and Deno's ecosystem fit is weakest here. Everything
else the daemon does — newline-delimited JSON over a unix socket, git subprocesses, tracker
HTTP, file I/O — is unremarkable on any of them.

"Customisable" means "you can write TypeScript." This is acceptable for a personal tool and
would need revisiting if teammates are ever expected to tune pipelines. If that day comes, the
migration is to generate the code path from config for the generic subset only — never for the
typed Phases below.

The invariants this protects are the reason for the decision, and are the things a future reader
must not "simplify":

- **Verification may not extend the Finding list.** It answers "were findings 1, 3, 5 closed?"
  and nothing else. New defects it notices route to Spawned Tickets or PR comments. This is the
  sole termination guarantee of the remediation loop; a full re-review can always find something
  new, so the list must only ever shrink.
- **Remediation is blinded.** It receives only in-scope Findings. Scope is enforced by
  withholding, not by instruction — an agent handed every Finding and told to fix only some will
  rationalise its way past the boundary.
- **Acceptance must survive the Vacuity Guard.** A new test must pass at HEAD and fail at
  HEAD~1. Without this, tests written after reading the implementation assert the implementation
  back to itself, pass forever, and silently break Feature QA attribution.
- **Every Phase runs in a fresh Worker.** A Phase reviewing or remediating its own prior output
  is not a separate Phase.

Reordering Phases is a code change and therefore reviewable, which is the desired property: the
sequence is not arbitrary and should not look adjustable.
