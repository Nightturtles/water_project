# Plan 007: Put the Deno edge functions under CI (lint + check) and unit-test submit-support

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 59bd719..HEAD -- supabase/functions/submit-support/index.ts supabase/functions/estimate-water/index.ts .github/workflows/ci.yml`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / tests
- **Planned at**: commit `59bd719`, 2026-06-17

## Why this matters

The repo has two Supabase Edge Functions (`estimate-water`, `submit-support`),
both written in TypeScript for the Deno runtime. **Neither is checked or tested
anywhere.** ESLint ignores `supabase/` ([eslint.config.js](../eslint.config.js)
line 22), `tsconfig.json` excludes `supabase`, both files carry `// @ts-nocheck`,
and no GitHub Actions workflow runs Deno. The most exposed of the two —
`submit-support` — is a **public, unauthenticated, email-sending** endpoint, and
it has zero automated verification of its input validation, honeypot, or HTML
escaping. A typo or a regression in that validation ships straight to production.

This plan adds a Deno CI job (`deno lint` over both functions, `deno check` on
submit-support) and a `deno test` unit suite for submit-support's request handler.
It also establishes the harness that plan 008 (rate-limiting) extends, so that
work ships with tests instead of by inspection.

## Current state

- `supabase/functions/submit-support/index.ts` — the handler is an anonymous
  function passed straight to `Deno.serve` at the bottom of the file, and the
  file starts with `// @ts-nocheck`. The relevant top and bottom:

```ts
// @ts-nocheck — Deno runtime; the project's tsconfig targets the browser JS
//               files and doesn't carry Deno's globals or the https:// imports.

const RESEND_URL = "https://api.resend.com/emails";
// ... consts: SUPPORT_INBOX, FROM, NAME_MAX, EMAIL_MAX, MESSAGE_MAX, SEND_TIMEOUT_MS, CORS ...
// ... helpers: json(), looksLikeEmail(), escapeHtml() ...

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // ... validation, honeypot, Resend fetch ...
  return json({ ok: true });
});
```

  Because the handler is inlined into `Deno.serve`, it cannot be imported and
  unit-tested. This plan extracts it to a named export and guards the
  `Deno.serve` call so importing the module in a test does not start a server.

- `supabase/functions/estimate-water/index.ts` — same `// @ts-nocheck` header,
  but it ALSO has a remote import: `import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";`. `deno check` on this file would download and type-check that remote module (slow/flaky in CI), so this plan deliberately **keeps estimate-water's `@ts-nocheck`** and only `deno lint`s it (lint is syntactic and does not resolve remote imports). Type-checking estimate-water is a documented follow-up, not part of this plan.

- `.github/workflows/ci.yml` — has three jobs: `typecheck-and-test`, `e2e`, and
  `deploy`. `deploy` runs only on push-to-main and is gated:
  `needs: [typecheck-and-test, e2e]`. This plan adds an `edge-functions` job and
  appends it to `deploy.needs` so a red edge-function check blocks the publish.

- `tsconfig.json` `exclude` is `["node_modules", "coverage", "supabase"]` — so
  removing `@ts-nocheck` from submit-support will NOT affect `npm run typecheck`
  (tsc never looks in `supabase/`). Verified at planning time; re-confirm via the
  drift check.

- Deno is NOT installed on the planning machine. The executor must install it
  (Step 1). The standard CI action is `denoland/setup-deno`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install Deno (macOS) | `brew install deno` *or* `curl -fsSL https://deno.land/install.sh \| sh` | `deno --version` prints a 2.x version |
| Lint functions | `deno lint` (run inside `supabase/functions/`) | exit 0 |
| Type-check submit-support | `deno check submit-support/index.ts` (inside `supabase/functions/`) | exit 0 |
| Unit tests | `deno test --allow-env` (inside `supabase/functions/`) | all pass |
| Repo typecheck (unchanged) | `npm run typecheck` (repo root) | exit 0 (proves removing `@ts-nocheck` didn't leak into tsc) |
| Repo lint (unchanged) | `npm run lint` | exit 0 |

If you cannot install Deno in your environment, STOP and report — local
verification is required; do not rely on CI alone for the first landing.

## Scope

**In scope** (the only files you should modify or create):

- `supabase/functions/submit-support/index.ts` — extract the handler to a named export; guard `Deno.serve`; remove `@ts-nocheck`.
- `supabase/functions/submit-support/index.test.ts` (create) — the Deno unit tests.
- `.github/workflows/ci.yml` — add the `edge-functions` job; add it to `deploy.needs`.

**Out of scope** (do NOT touch):

- `supabase/functions/estimate-water/index.ts` — keep its `@ts-nocheck`; it is only `deno lint`ed here, not type-checked (remote import). Do not refactor it.
- The submit-support handler's BEHAVIOR — this plan is a pure extract-and-test refactor. Status codes, validation rules, the honeypot, the Resend payload, and the escaping must all stay byte-for-byte equivalent. (Rate-limiting is plan 008, separately.)
- `eslint.config.js` / `tsconfig.json` — the Deno files stay out of the Node toolchain; Deno checks them instead.
- Any migration or `supabase/config.toml` change.

## Suggested executor toolkit

- Deno's testing API: `Deno.test(name, fn)` with `jsr:@std/assert` or the built-in `node:assert`. To avoid adding a remote dependency, prefer Deno's own `assert` from `jsr:@std/assert@1` *only if* network is available; otherwise use `import { strict as assert } from "node:assert";` (Deno supports `node:` specifiers with no extra permission). Pick one and use it consistently.

## Steps

### Step 1: Install Deno and confirm the baseline

Install Deno (see Commands). Then, inside `supabase/functions/`:

- `deno lint` over the directory. It will lint BOTH functions. If it reports
  findings, they are pre-existing. Triage: fix anything that is a clear, safe
  improvement; for an intentional pattern deno-lint dislikes, add a
  `// deno-lint-ignore <rule> -- <reason>` line. If it flags something that looks
  like a **real bug**, STOP and report it (don't paper over it).

**Verify**: `deno lint` → exit 0 (after triage).

### Step 2: Extract the submit-support handler and remove @ts-nocheck

In `supabase/functions/submit-support/index.ts`:

1. Delete the two `// @ts-nocheck` comment lines at the top (keep the rest of the
   header comment block).
2. Change the bottom of the file from the inlined `Deno.serve(async (req) => { ... })`
   to a named, exported handler plus a guarded serve call:

```ts
export async function handler(req: Request): Promise<Response> {
  // ...exact existing body, unchanged...
  return json({ ok: true });
}

// Only start the server when this module is the program entry point (i.e. when
// the Supabase edge runtime runs it). When imported by index.test.ts, this is
// false, so no server binds during tests.
if (import.meta.main) {
  Deno.serve(handler);
}
```

Do not change anything inside the handler body. The `const`s and helper
functions (`json`, `looksLikeEmail`, `escapeHtml`) stay at module scope as they
are. (If `escapeHtml` or `looksLikeEmail` are needed by the test, they can be
exercised through `handler` — you do NOT need to export them.)

**Verify**:

- Inside `supabase/functions/`: `deno check submit-support/index.ts` → exit 0. If `deno check` reports type errors, they are real (the file was previously `@ts-nocheck`'d). Fix obvious annotation gaps; if an error is non-trivial or implies a behavior change, STOP and report.
- At repo root: `npm run typecheck` → exit 0 (confirms tsc still ignores `supabase/`).

### Step 3: Write the unit test

Create `supabase/functions/submit-support/index.test.ts`. Import the handler:
`import { handler } from "./index.ts";`. Stub the network and env per test:

- Set the secret: `Deno.env.set("RESEND_API_KEY", "test-key")` (and `delete` / reset it for the misconfig case).
- Stub `globalThis.fetch` with a fake that records the call and returns a chosen `Response`. Restore the original `fetch` in a `finally` so tests don't bleed into each other.

Helper to build a request:

```ts
function postReq(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/submit-support", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
```

Cover these cases (each asserts the HTTP status and, where relevant, that `fetch`
was or was NOT called and what payload it received):

1. `OPTIONS` request → status 200, body `"ok"`, CORS header present; `fetch` not called.
2. `GET` request → status 405 (`method_not_allowed`); `fetch` not called.
3. Body is not valid JSON → status 400 (`bad_request`, "invalid json").
4. Body is a JSON array (not an object) → status 400 ("body must be an object").
5. Honeypot tripped (`company: "x"`) → status 200 `{ ok: true }` AND `fetch` was NOT called (the email is silently dropped).
6. Missing/blank `name` → 400; `name` longer than 100 chars → 400.
7. Invalid `email` (e.g. `"nope"`) → 400; `email` longer than 254 → 400.
8. Blank `message` → 400; `message` longer than 5000 → 400.
9. `RESEND_API_KEY` unset → status 500 (`server_misconfigured`); `fetch` not called. (Use `Deno.env.delete("RESEND_API_KEY")` for this case.)
10. Happy path (valid name/email/message, fetch stub returns `new Response(null, { status: 200 })`) → handler returns 200 `{ ok: true }`, and the stubbed `fetch` was called once against `https://api.resend.com/emails` with an `Authorization: Bearer test-key` header and a JSON body whose `reply_to` equals the submitted email, `to` is `["info@cafelytic.com"]`, and `subject` contains the submitted name.
11. HTML-escaping: submit `name: "<script>alert(1)</script>"`; assert the `html` field in the stubbed fetch body contains `&lt;script&gt;` and does NOT contain a raw `<script>`. (The `text` field is plaintext and intentionally not escaped — do not assert escaping there.)
12. Resend returns non-OK (fetch stub returns `new Response("boom", { status: 500 })`) → handler returns 502 (`send_failed`).
13. Resend fetch throws a `TimeoutError` (stub: `throw new DOMException("timed out", "TimeoutError")`) → handler returns 504 (`timeout`). A generic thrown `Error` → 502 (`network`).

**Verify**: inside `supabase/functions/`: `deno test --allow-env` → all cases pass.

If `deno test` hangs or reports that a port is in use, the `import.meta.main`
guard from Step 2 is not suppressing `Deno.serve` in your runtime. Fallback:
move the handler + module-scope consts/helpers into a new
`supabase/functions/submit-support/handler.ts`, have `index.ts` do
`import { handler } from "./handler.ts"; Deno.serve(handler);`, and import the
handler from `./handler.ts` in the test. Note this fallback in your report
(plan 008 needs to know which file holds the handler).

### Step 4: Add the CI job

In `.github/workflows/ci.yml`, add a new job (mirror the existing jobs' style —
`runs-on: ubuntu-latest`, `actions/checkout@v4`):

```yaml
  edge-functions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - run: deno lint
        working-directory: supabase/functions
      - run: deno check submit-support/index.ts
        working-directory: supabase/functions
      - run: deno test --allow-env
        working-directory: supabase/functions
```

Then extend the deploy gate so a red edge-function check blocks publish: change
`needs: [typecheck-and-test, e2e]` on the `deploy` job to
`needs: [typecheck-and-test, e2e, edge-functions]`.

**Verify**: the YAML is well-formed — `npm run lint` won't cover it, so eyeball
the indentation against the sibling jobs. (If `actionlint` happens to be
installed, run it; do not install it just for this.)

### Step 5: Repo-level sweep

**Verify** (repo root): `npm run typecheck` → exit 0; `npm run lint` → exit 0;
`npm test` → all pass. (These should be unaffected; this confirms the Deno work
didn't leak into the Node toolchain.)

## Test plan

- New file `supabase/functions/submit-support/index.test.ts` with the 13 cases in
  Step 3. The load-bearing regressions are #5 (honeypot drops silently — no
  email), #10 (happy-path Resend payload shape), and #11 (HTML escaping of
  user input). These are exactly the behaviors that, if broken, ship to a public
  endpoint unnoticed today.
- There is no existing Deno test to model on (this is the first). Model the
  structure loosely on the repo's Vitest style — small, named cases, one
  behavior each.
- Verification: `deno test --allow-env` (inside `supabase/functions/`) → all pass.

## Done criteria

ALL must hold:

- [ ] `supabase/functions/submit-support/index.ts` no longer contains `@ts-nocheck`; exports `handler`; guards `Deno.serve` (or the documented `handler.ts` fallback is in place)
- [ ] Inside `supabase/functions/`: `deno lint` exits 0, `deno check submit-support/index.ts` exits 0, `deno test --allow-env` passes all cases
- [ ] `.github/workflows/ci.yml` has an `edge-functions` job and `deploy.needs` includes `edge-functions`
- [ ] The submit-support handler's responses are unchanged vs `59bd719` (pure refactor — verify by reading the diff: only the function signature/wrapper and the removed `@ts-nocheck` should differ, plus the new test file and CI job)
- [ ] Repo root: `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] estimate-water/index.ts is unchanged
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- You cannot install Deno locally (don't land this verified only by CI).
- `deno check submit-support/index.ts` surfaces a type error that implies the handler's behavior is wrong (not just a missing annotation) — that's a real finding for a separate plan.
- `deno test` cannot avoid starting a server even after the `handler.ts` fallback — report the Deno version and behavior.
- The drift check shows submit-support/index.ts already changed since `59bd719` (e.g. plan 008 landed first) — re-read it; the handler may already be extracted, in which case skip Step 2's extraction and only add the test + CI.
- `deno lint` flags what looks like a genuine bug in either function.

## Maintenance notes

- **Follow-up (deliberately deferred)**: bring `estimate-water/index.ts` under `deno check` too. It needs its remote `https://esm.sh/...` import handled — either vendor it, add a `supabase/functions/deno.json` import map, or accept the remote download in CI. Out of scope here to keep this plan low-risk.
- Plan 008 (rate-limit submit-support) edits this same handler and should add its rate-limit cases to `index.test.ts`. Its new `fetch` calls (the quota RPC) must be distinguishable from the Resend call in the test stub by URL.
- Reviewer: confirm Step 2 is a pure refactor (no behavior change in the diff), the honeypot test (#5) really asserts `fetch` was not called, and the deploy gate now lists `edge-functions`.
- If CI's `deno test` ever needs network or write permissions, add the narrowest `--allow-*` flag; today `--allow-env` is sufficient because the tests stub `fetch`.
