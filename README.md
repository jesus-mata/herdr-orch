# herdr-orch

An unattended agent Orchestrator built on [herdr](https://herdr.dev). It takes a Spec's worth of
tickets and hands back one reviewable pull request the next morning.

`CONTEXT.md` is the glossary and the vocabulary the code uses. `docs/adr/` records the decisions.
`docs/specs/` holds the specs.

## Requirements

- Node LTS (>= 22.16). TypeScript runs directly under Node's type stripping; there is no build step.
- herdr 0.7.5 or later, speaking socket protocol 17.
- `git` and the `gh` CLI, authenticated. `gh` is how the GitHub Tracker and Forge talk to GitHub.

## Running a Batch

```bash
node --experimental-strip-types scripts/orch-batch.ts --dry-run   # what intake found
node --experimental-strip-types scripts/orch-batch.ts             # run it
```

A Spec is an issue labelled `ready-for-agent` that has sub-issues; those sub-issues, open and in
GitHub's own order, are its Tickets. A labelled issue with no sub-issues is a Ticket somebody
labelled, not a Spec. A Ticket labelled `ready-for-human` is a HITL Ticket and is never attempted.
A Spec whose Tickets cannot be read is refused on its own and escalates as itself; the rest of the
Batch still runs.

Each Run gets a worktree under `--workspace-root` (by default `~/.herdr-orch/worktrees`) on its own
`orch/…` branch, based on the default branch as the Forge has just fetched it — nobody pulls at 3am,
so the Orchestrator does. It opens a herdr workspace on that worktree, with a tab and pane per
Ticket. Worktrees and panes are left in place afterwards, deliberately: they are what an escalation
preserves.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # node --test
npm run check       # all three
```

Tests need neither a running herdr nor a language model. There are two fakes and no more: a stub
herdr server on a real unix socket, for the client's own wire behaviour, and a **scripted agent** —
a fake herdr client whose Workers perform real side effects in a real temporary Git repository. Git,
the filesystem and the Orchestrator itself are real throughout.

To check the herdr integration against live herdr — after a herdr upgrade, say:

```bash
node --experimental-strip-types scripts/herdr-smoke.ts
```

## What exists so far

The walking skeleton: one Spec of one Ticket, implement only, through to a pull request. No review,
no Verdict validation, no QA yet — the point is that every integration point connects.

- `src/orchestrator/` — `runBatch`, the single entry point, taking a Tracker, a Forge, a herdr
  client and a workspace root. Below it, one Run: worktree and branch, workspace, tab and pane,
  a fresh Worker, the prompt, the commit, the push, the pull request. A Run returns a Deliverable
  or an Escalation and never throws, so one Run cannot take a Batch down with it.
- `src/tracker/`, `src/forge/` — the two ports, deliberately separate (Jira is a tracker with no
  forge), with GitHub adapters over `gh`, and the provider-agnostic Ticket body parser.
- `src/herdr/` — the client for herdr's socket API: socket-path resolution matching herdr's own
  CLI, newline-delimited JSON framing, request/reply correlation, a pane agent status subscription
  that reconnects and reconciles, and typed wrappers for the methods in use. See ADR-0004 for the
  connection model herdr's socket actually permits. `HerdrApi` is the narrower port a Run depends
  on and the one the scripted agent stands in for.
- `src/git/`, `src/process/` — real Git, shelled out to, through the one place anything shells out.
