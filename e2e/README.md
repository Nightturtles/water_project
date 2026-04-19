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

## When to reach for the MCP runbooks vs. specs

See the "Verifying changes" section of [../CLAUDE.md](../CLAUDE.md). Short version: when there's a `.spec.ts` for the flow, run it. When there isn't (e.g. anything needing a logged-in Supabase session), follow the `.md` runbook via the Playwright MCP.

## Index

| Flow | Spec | Runbook | Notes |
|---|---|---|---|
| index.html golden path + Sentry wiring + FOUC guard | [smoke-index.spec.ts](smoke-index.spec.ts) | [smoke-index.md](smoke-index.md) | Spec is the source of truth; runbook mirrors it as prose |
| Recipe Builder — auto-save + creator-gated share prompt | — | [smoke-recipe.md](smoke-recipe.md) | Needs a logged-in account; not yet specced |
| Multi-device sync scenarios | — | [smoke-sync.md](smoke-sync.md) | Needs two contexts + a test account; not yet specced |
