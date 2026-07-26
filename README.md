# herdr-orch

An unattended agent Orchestrator built on [herdr](https://herdr.dev). It takes a Spec's worth of
tickets and hands back one reviewable pull request the next morning.

`CONTEXT.md` is the glossary and the vocabulary the code uses. `docs/adr/` records the decisions.
`docs/specs/` holds the specs.

## Requirements

- Node LTS (>= 22.16). TypeScript runs directly under Node's type stripping; there is no build step.
- herdr 0.7.5 or later, speaking socket protocol 17.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # node --test
npm run check       # all three
```

Tests never need a running herdr: the herdr client is exercised against a stub server over a real
unix socket. To check the integration itself against live herdr — after a herdr upgrade, say:

```bash
node --experimental-strip-types scripts/herdr-smoke.ts
```

## What exists so far

`src/herdr/` — the client for herdr's socket API. Socket-path resolution matching herdr's own CLI,
newline-delimited JSON framing, request/reply correlation, a pane agent status subscription that
reconnects and reconciles, and typed wrappers for the methods in use. See ADR-0004 for the
connection model herdr's socket actually permits.
