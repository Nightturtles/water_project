# E2E Smoke Runbooks

These are **runbooks for Claude** — not Playwright test files (`*.spec.ts`). Each `.md` in this directory is a playbook a Claude Code session follows step-by-step using the Playwright MCP server (`mcp__playwright__*` tools) to verify a user-observable flow.

## Why runbooks and not spec files

- No Node, no `playwright` npm install, no test runner needed at Phase 2 — the MCP server drives a real Chromium in isolation, and Claude is the runner.
- Runbooks describe **intent** ("verify share prompt only shows for the creator") instead of brittle selectors. When DOM IDs shift, Claude adapts the selectors; the intent remains true.
- When Phase 3 lands Vite + Vitest, we may or may not add Playwright spec files. This directory is the forward-compatible starting point either way.

## How to run one

In a Claude Code session:

```
Run e2e/smoke-index.md against the local dev server.
```

Claude starts `npx http-server` (or `vite preview` post-Phase-3) via the Claude Preview MCP, then drives the browser through each step via the Playwright MCP. For production smokes, substitute `https://cafelytic.com` as the base URL.

## When to reach for these vs. Claude Preview MCP

See the "Verifying changes" section of [../CLAUDE.md](../CLAUDE.md).

## Runbook index

| File | Flow | Motivated by |
|---|---|---|
| [smoke-index.md](smoke-index.md) | Main Coffee Water Calculator page — starting water, target profile, mineral recommendations | Core golden path |
| [smoke-recipe.md](smoke-recipe.md) | Recipe Builder — auto-save on Done Editing, creator-gated share prompt | Commits ae7376e, save-status regressions |
| [smoke-sync.md](smoke-sync.md) | Multi-device sync — save-on-navigate, push-then-pull initSync, cross-device delete | Commits 6d8cd63, 6464fdb, 9f89a2e |
