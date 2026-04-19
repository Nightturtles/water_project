# E2E — spec files + runbooks

Two formats live here:

- **`*.spec.ts`** — executable Playwright tests. Run locally with `npm run test:e2e`; gated in CI via the `e2e` job.
- **`*.md`** — markdown runbooks for Claude to execute via the Playwright MCP server. Used for flows that aren't yet automated (usually because they need a test Supabase account or manual setup).

Both formats describe the same flows; specs supersede runbooks where they exist, but the runbooks stay as living documentation and as fallback instructions for flows that can't be automated.

## Running locally

```bash
npm run test:e2e              # all specs, one-shot
npx playwright test --ui      # interactive UI mode for debugging
npx playwright test --debug   # step-through debugger
```

The `webServer` config in `playwright.config.ts` boots `npx http-server . -c-1 -p 8080` automatically — no need to start it separately. Locally, an already-running server on 8080 is reused; in CI a fresh one is spawned per run.

## When to reach for what

See the "Verifying changes" section of [../CLAUDE.md](../CLAUDE.md) for the full decision matrix. Short version:

- **Single-page, single-flow change during development** → Claude Preview MCP (`preview_start` + `preview_eval`/`preview_snapshot`/`preview_console_logs`). Fast, sandboxed to the local server, zero setup cost per run.
- **Flow that has a `.spec.ts` here** → `npm run test:e2e`. Deterministic, gated in CI.
- **Flow that only has a `.md` runbook here** (typically anything needing a logged-in Supabase session, multiple browser contexts, or production-origin checks) → Playwright MCP driving the `.md` runbook step-by-step.

## Index

| Flow | Spec | Runbook | Notes |
|---|---|---|---|
| index.html golden path + Sentry wiring + FOUC guard | [smoke-index.spec.ts](smoke-index.spec.ts) | [smoke-index.md](smoke-index.md) | Spec is the source of truth; runbook mirrors it as prose |
| Recipe Builder — auto-save + creator-gated share prompt | — | [smoke-recipe.md](smoke-recipe.md) | Needs a logged-in account; not yet specced |
| Multi-device sync scenarios | — | [smoke-sync.md](smoke-sync.md) | Needs two contexts + a test account; not yet specced |
