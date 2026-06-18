# Plan 009: Add an e2e spec for the support contact form (client-side flow)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 59bd719..HEAD -- support.html e2e/smoke-estimate-water.spec.ts`
> If `support.html` changed since this plan was written, compare its form/script
> against the "Current state" excerpt before proceeding; on a mismatch in the
> element ids or the invoke call, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `59bd719`, 2026-06-17

## Why this matters

The Support page ([support.html](../support.html), added in #183) is the only way
a logged-out or locked-out user can reach the maintainer, and its submit flow has
**zero automated coverage**. A regression in the client-side validation, the
`functions.invoke("submit-support", ...)` call, or the success/error UI would ship
silently. The repo already has the exact pattern for testing an edge-function-backed
flow without hitting the network — [e2e/smoke-estimate-water.spec.ts](../e2e/smoke-estimate-water.spec.ts)
intercepts the function call with `page.route("**/functions/v1/<name>", ...)`. This
plan adds the parallel spec for the support form.

(Server-side logic — validation, honeypot, escaping, rate-limiting — is covered by
the Deno unit tests in plans 007/008. This plan covers only what the browser does:
field validation, the invoke call shape, and the success/error UI.)

## Current state

`support.html` (the load-bearing parts — element ids and the submit handler):

```html
<form class="login-form" id="support-form" novalidate>
  <input type="text"     id="support-name"    name="name"    maxlength="100" ... required>
  <input type="email"    id="support-email"   name="email"   maxlength="254" ... required>
  <textarea              id="support-message"  name="message" maxlength="5000" required></textarea>
  <!-- honeypot, off-screen --> <input type="text" id="support-company" name="company" ...>
  <div class="login-error"   id="support-error"   role="alert"></div>
  <div class="login-success" id="support-success" role="status" style="display:none;"></div>
  <button type="submit" class="login-submit-btn" id="support-submit">Send message</button>
</form>
```

Client submit handler (in the inline `<script>`):

- Validates: blank name → error `"Please enter your name."`; bad email (regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) → `"Please enter a valid email address."`; blank message → `"Please enter a message."`. On any of these it `return`s without calling the function.
- On valid input: disables the button (label → `"Sending…"`), then
  `await window.supabaseClient.functions.invoke("submit-support", { body: { name, email, message, company } })`.
- Success contract: throws unless `!error && data && data.ok === true`. On success it
  calls `form.reset()` and shows `"Thanks! Your message has been sent. We'll reply to the email you provided."` in `#support-success`.
- On any throw: logs to console and shows `"Sorry, we couldn't send your message. Please try again, or email info@cafelytic.com directly."` in `#support-error`; does NOT reset the form. `finally` re-enables the button.

The exemplar's interception + login-stub helpers (from smoke-estimate-water.spec.ts —
copy/adapt these; the support form does not gate on login, so you do NOT need
`stubLogin`):

```ts
async function stubFunctions(page, handler) {
  const invocations = [];
  await page.route("**/functions/v1/estimate-water", async (route) => {
    const body = route.request().postDataJSON();
    invocations.push({ body });
    const result = handler(body);
    await route.fulfill({
      status: result.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(result.body),
    });
  });
  return { invocations };
}
```

Playwright config: the `*.spec.ts` suite runs against the built `dist/` via
`vite preview` (per CLAUDE.md), with a `baseURL` set, so `page.goto("/support.html")`
works and the intercepted invoke never reaches a real Supabase project. The other
specs in `e2e/` are the structural model for `test.describe` / fixtures.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run just this spec | `npm run test:e2e -- support-form` | the new spec passes |
| Full e2e suite | `npm run test:e2e` | all pass / creds-gated specs skip |
| Lint | `npm run lint` | exit 0 (the e2e block allows `any`) |
| Typecheck | `npm run typecheck` | exit 0 (`**/*.test.ts` is in tsconfig, and `e2e/**/*.spec.ts` is type-checked too) |

First-time setup: Playwright browsers must be installed —
`npx playwright install chromium` (CI does this; do it locally if the run errors
about a missing browser).

## Scope

**In scope** (the only file you should create):

- `e2e/support-form.spec.ts` (create)

**Out of scope** (do NOT touch):

- `support.html` and its inline script — this plan only adds a test of existing behavior. If the test reveals a real bug, STOP and report it (don't fix it here).
- `e2e/smoke-estimate-water.spec.ts` — copy its helpers into the new file; do not refactor shared helpers into a common module (the suite currently duplicates small helpers per spec; match that convention).
- `playwright.config.ts`, CI workflows.

## Steps

### Step 1: Scaffold the spec with a route stub for submit-support

Create `e2e/support-form.spec.ts`. Add a `stubSubmitSupport(page, handler)` helper
modeled on the exemplar but routing `**/functions/v1/submit-support`, returning the
captured `invocations`. Define a couple of canned responses:

```ts
const OK_RESPONSE = { ok: true };
const FAIL_RESPONSE = { ok: false, error: "send_failed" };
```

A success handler returns `{ body: OK_RESPONSE }`; a failure handler returns
`{ status: 502, body: FAIL_RESPONSE }`.

### Step 2: Write the test cases

Under a `test.describe("support form", ...)`:

1. **Blank name blocks submit**: goto `/support.html`; leave name empty, fill a valid email + message; click `#support-submit`. Assert `#support-error` shows `"Please enter your name."` and `invocations` is empty (the function was never called).
2. **Invalid email blocks submit**: fill name, email `"nope"`, message; submit. Assert `#support-error` mentions a valid email and `invocations` is empty.
3. **Blank message blocks submit**: fill name + valid email, empty message; submit. Assert the message error and `invocations` empty.
4. **Happy path**: fill name `"Ada"`, email `"ada@example.com"`, message `"Hello there"`; submit with the success stub. Assert:
   - `#support-success` becomes visible and contains `"has been sent"`.
   - `invocations` has length 1 and `invocations[0].body` deep-equals `{ name: "Ada", email: "ada@example.com", message: "Hello there", company: "" }` (the honeypot value is the empty hidden input).
   - The form reset: `#support-name`, `#support-email`, `#support-message` are all empty after success.
5. **Server failure shows the error and does NOT reset**: fill the same valid fields; submit with the failure stub (status 502). Assert `#support-error` contains `"couldn't send"` and `#support-name` still holds `"Ada"` (form not reset). Optionally assert `#support-submit` is re-enabled (the `finally` block).

Notes for the executor:
- The form has `novalidate`, so the browser won't block submit — the JS validation
  is what you're testing. Use `page.locator("#support-submit").click()` to submit.
- For the "function never called" assertions (cases 1-3), give any late request a
  beat to surface before asserting empty, mirroring the exemplar's
  `await page.waitForTimeout(1000); expect(invocations).toHaveLength(0);` pattern —
  but since validation returns synchronously here, a short wait is enough.
- `support.html` wires the form on `DOMContentLoaded` and relies on
  `window.supabaseClient` (created by the `legacy-globals.ts` module). Against
  `vite preview` this is present; if the invoke never fires on the happy path,
  confirm the page actually loaded the module (check for console errors via
  `page.on("console", ...)`) — but do NOT stub `window.supabaseClient` wholesale;
  the network route is the correct interception layer (the client still
  initializes and issues the fetch, which your route catches).

### Step 3: Run and verify

**Verify**:

- `npm run test:e2e -- support-form` → the new spec's cases all pass.
- `npm run typecheck` → exit 0 (the spec is type-checked).
- `npm run lint` → exit 0.

Then run the full suite once to ensure no interaction:

- `npm run test:e2e` → all pass; credential-gated specs (smoke-sync signed-in cases) may skip without `.env.test` — that still counts as green. Known environmental flake: a "Failed to fetch" inside `_getUser` against prod Supabase; re-run the failing spec once before treating it as a regression.

## Test plan

This plan IS a test. The new `e2e/support-form.spec.ts` covers the five cases
above. The load-bearing ones are #4 (happy-path invoke body shape + success UI +
form reset) and #5 (failure path shows the error and preserves the user's typed
input so they don't lose their message).

## Done criteria

ALL must hold:

- [ ] `e2e/support-form.spec.ts` exists with the 5 cases
- [ ] `npm run test:e2e -- support-form` passes
- [ ] `npm run typecheck` exits 0 and `npm run lint` exits 0
- [ ] `npm run test:e2e` (full) passes (creds-gated skips allowed; note them in the report)
- [ ] No file other than `e2e/support-form.spec.ts` was modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The element ids or the success/error strings in `support.html` don't match "Current state" (drift) — the spec's assertions would be wrong.
- The happy-path invoke never reaches the route stub even though the page loaded without console errors — report what the page did (the invoke contract may have changed).
- A test reveals an actual bug in `support.html` (e.g. the form resets on failure, or sends the honeypot field under the wrong key) — report it; do not fix `support.html` in this plan.
- The full e2e suite has a NEW failure unrelated to support (not the known `_getUser` flake) — report it rather than editing other specs.

## Maintenance notes

- This spec stubs the network, so it never exercises the real submit-support function or sends email — that's intentional (fast, deterministic, no Resend cost). Server behavior is covered by the Deno tests (plans 007/008).
- If support.html is later migrated from its inline script to a TS module (the in-flight classic-JS → TS effort), this spec is the safety net for that change — keep it green through the migration.
- Reviewer: confirm the happy-path test asserts the exact invoke body (including `company: ""`), since that body shape is the contract between the form and the function; and that case #5 asserts the form is NOT reset on failure.
