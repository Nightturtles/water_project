# Plan 008: Rate-limit the public submit-support endpoint with a per-IP daily quota

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 59bd719..HEAD -- supabase/functions/submit-support/index.ts supabase/migrations`
> If submit-support/index.ts changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding. NOTE: plan
> 007 may have already extracted the handler into an exported `handler`
> function (or a `handler.ts` file) and removed `@ts-nocheck` — that is
> expected and good; apply this plan's changes to wherever the handler body
> now lives. If the handler is still an inline `Deno.serve(...)` callback,
> apply them there. Any OTHER unexpected change is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/007 (soft — land 007 first so this ships with deno tests; not a hard blocker)
- **Category**: security
- **Planned at**: commit `59bd719`, 2026-06-17

## Why this matters

`submit-support` is configured `verify_jwt = false` in
[supabase/config.toml](../supabase/config.toml) (lines 382-383) so logged-out and
locked-out users can reach support — that's correct and must stay. But it makes
the function a **public, unauthenticated endpoint that sends an email via Resend
on every well-formed call**, and its only abuse defense is a honeypot field, which
an attacker bypasses simply by not sending the `company` field. The Supabase
anon key and the function URL are both in the shipped client bundle, so anyone
can `POST {name,email,message}` in a loop and:

- burn Resend send credits / hit the Resend account's rate limits, and
- flood info@cafelytic.com, and
- risk getting the cafelytic.com sending domain flagged for spam (which would also
  hurt Supabase Auth emails, which use the same domain — see SUPABASE_SMTP.md).

The sibling function `estimate-water` already solves the equivalent problem with a
per-user daily quota table + an atomic increment RPC called via the service role
([estimate-water/index.ts:132-165](../supabase/functions/estimate-water/index.ts),
migration [20260519043445_estimate_water_daily_quota.sql](../supabase/migrations/20260519043445_estimate_water_daily_quota.sql)).
This plan mirrors that pattern, keyed by a **hash of the client IP** instead of a
user id (there is no authenticated user here).

This is a speed bump, not a wall: IP-based limits don't stop a distributed botnet
and `x-forwarded-for` can be spoofed. But it converts "unlimited free emails from
one caller" into "a bounded number per IP per day," which is the standard,
proportionate defense for a public contact form and removes the cheapest abuse path.

## Current state

`supabase/functions/submit-support/index.ts` today (at `59bd719`) has **no
database access at all** — its header comment even says *"No database writes: this
is email-only, so there's no migration and no row to leak."* That comment becomes
stale with this plan; update it. The handler, after validating input and checking
the `RESEND_API_KEY`, goes straight to the Resend `fetch`:

```ts
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const subject = `Cafelytic support: message from ${name}`;
  // ...build text + html...
  let resp: Response;
  try {
    resp = await fetch(RESEND_URL, { /* ...Resend send... */ });
  } catch (e) { /* ...timeout/network... */ }
```

The platform auto-injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into
every edge function (documented in estimate-water's header). estimate-water uses
the service role to call its quota RPC. This plan does the same, but **via a raw
`fetch` to the PostgREST RPC endpoint** rather than the supabase-js SDK — so
submit-support stays import-free and fast to cold-start (and plan 007's
`deno check` on it keeps working without resolving a remote import).

The quota-table + RPC convention to mirror (from the estimate-water migration):

```sql
create table public.estimate_water_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.estimate_water_quota enable row level security;  -- no policies = service-role-only
create or replace function public.increment_estimate_water_quota(p_user_id uuid)
returns integer language plpgsql security definer set search_path = public
as $$ declare new_count integer;
begin
  insert into estimate_water_quota (user_id, day, count, updated_at)
  values (p_user_id, current_date, 1, now())
  on conflict (user_id, day)
  do update set count = estimate_water_quota.count + 1, updated_at = now()
  returning count into new_count;
  return new_count;
end; $$;
revoke all on function public.increment_estimate_water_quota(uuid) from public;
grant execute on function public.increment_estimate_water_quota(uuid) to service_role;
```

Migration mechanics (from CLAUDE.md "Migrations"): files live in
`supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`; create them with
`supabase migration new <name>` so the timestamp is correct; validate locally
with `supabase db reset`. **You (the executor) do NOT run `supabase db push`** —
that is the human gate. `supabase db push` is denied in this repo's Claude config.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| New migration | `supabase migration new add_support_submission_quota` | creates `supabase/migrations/<ts>_add_support_submission_quota.sql` |
| Start local stack (if down) | `supabase start` | local Postgres + API up |
| Replay all migrations locally | `supabase db reset` | exit 0, no SQL errors; ends with the new migration applied |
| Lint functions | `deno lint` (inside `supabase/functions/`) | exit 0 |
| Type-check submit-support | `deno check submit-support/index.ts` (inside `supabase/functions/`) | exit 0 (requires plan 007's `@ts-nocheck` removal; if 007 hasn't landed, skip this and rely on `deno lint`) |
| Unit tests | `deno test --allow-env` (inside `supabase/functions/`) | all pass |
| Migration status | `supabase migration list` | new version shows under Local (Remote stays blank until the human pushes) |

## Scope

**In scope** (the only files you should modify or create):

- `supabase/migrations/<new-timestamp>_add_support_submission_quota.sql` (create, via the CLI)
- `supabase/functions/submit-support/index.ts` (or wherever plan 007 moved the handler) — add IP hashing + the quota check + the 429 path; update the stale "no database" header comment
- `supabase/functions/submit-support/index.test.ts` — add the rate-limit cases (this file exists only if plan 007 landed; if it does not exist, create just enough of it to cover the new behavior, modeling on plan 007's described structure, OR note in your report that tests are deferred to 007)

**Out of scope** (do NOT touch):

- `estimate-water` and its quota table/RPC.
- `supabase/config.toml` — `verify_jwt` stays `false`; do NOT add auth.
- The existing input validation, honeypot, escaping, and Resend payload — leave all of it; this plan only INSERTS a quota gate between the input checks and the Resend send.
- Running `supabase db push` (human gate).
- Any client-side file (`support.html`) — the limit is enforced server-side; the client already shows a generic failure message, which is acceptable for a 429.

## Steps

### Step 1: Create the quota migration

Run `supabase migration new add_support_submission_quota`. In the generated file,
write a table + RPC keyed by `ip_hash text` (mirror the estimate-water exemplar
above, adapted):

```sql
-- Per-IP daily quota for the public submit-support Edge Function.
--
-- submit-support is verify_jwt = false (the Support page must work for
-- logged-out / locked-out users), so there is no user id to rate-limit on.
-- We bucket by a SHA-256 hash of the client IP instead. One row per
-- (ip_hash, day); the Edge Function calls increment_support_quota(ip_hash)
-- after input validation and before the Resend send. If the returned count
-- exceeds the daily limit, the function returns 429 and does not send.
--
-- IP hashing keeps raw IPs out of the table. This is a coarse abuse speed
-- bump, not a strong identity signal: x-forwarded-for can be spoofed and
-- shared NAT/CGNAT IPs share a bucket. Tune the limit in the Edge Function.
--
-- RLS is enabled with no policies, so anon/authenticated cannot read or
-- write the table. Only the service role (used by the Edge Function) can.

create table public.support_submission_quota (
  ip_hash text not null,
  day date not null default current_date,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ip_hash, day)
);

comment on table public.support_submission_quota is
  'Per-IP daily submit count for the submit-support Edge Function. Written exclusively via increment_support_quota() by the Edge Function (service role).';

alter table public.support_submission_quota enable row level security;
-- No policies = no access for anon/authenticated. Service role only.

create or replace function public.increment_support_quota(p_ip_hash text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into support_submission_quota (ip_hash, day, count, updated_at)
  values (p_ip_hash, current_date, 1, now())
  on conflict (ip_hash, day)
  do update set count = support_submission_quota.count + 1, updated_at = now()
  returning count into new_count;
  return new_count;
end;
$$;

comment on function public.increment_support_quota(text) is
  'Atomically increment today''s submit-support count for the given IP hash and return the new count. Called by the submit-support Edge Function via the service role.';

revoke all on function public.increment_support_quota(text) from public, anon, authenticated;
grant execute on function public.increment_support_quota(text) to service_role;
```

**Verify**: `supabase db reset` (start the local stack first with `supabase start`
if needed) → completes with no SQL error and the new migration listed as applied.
Re-read the generated file end-to-end (CLAUDE.md "Supabase safety" requires this —
do not trust the diff alone).

### Step 2: Add IP hashing + quota check to the handler

In the submit-support handler, add a small constant and a SHA-256 helper near the
other consts/helpers:

```ts
const SUPPORT_DAILY_LIMIT = 10; // per IP per day; tune as needed (see migration note)

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

Then, in the handler, **after** the input validation + honeypot + `RESEND_API_KEY`
check, and **before** building/sending the Resend email, insert the quota gate.
The order matters: honeypot bots and malformed requests already returned earlier
and never reach here, so the quota only counts well-formed, non-honeypot
submissions — the ones that would otherwise send a real email.

```ts
  // Per-IP daily rate limit. submit-support is unauthenticated, so we bucket by
  // a hash of the client IP. Counting happens here (after validation) so only
  // would-be sends consume quota.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl && serviceKey) {
    try {
      const xff = req.headers.get("x-forwarded-for") ?? "";
      const ip = xff.split(",")[0].trim() || "unknown";
      const ipHash = await sha256Hex(ip);
      const quotaResp = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_support_quota`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_ip_hash: ipHash }),
      });
      if (quotaResp.ok) {
        const count = await quotaResp.json(); // scalar integer from the RPC
        if (typeof count === "number" && count > SUPPORT_DAILY_LIMIT) {
          return json(
            {
              ok: false,
              error: "rate_limited",
              message: "You've sent several messages today. Please try again tomorrow, or email info@cafelytic.com directly.",
            },
            429,
          );
        }
      } else {
        // Quota infra returned non-OK. Fail OPEN (still let support through) but
        // leave a server log breadcrumb — blocking a legit support contact is
        // worse than letting an occasional extra message through during an outage.
        console.error("[submit-support] quota RPC non-OK:", quotaResp.status);
      }
    } catch (e) {
      console.error("[submit-support] quota check failed; failing open:", e);
    }
  }
```

Also update the stale header comment: the line claiming *"No database writes: this
is email-only, so there's no migration and no row to leak"* is no longer true —
replace it with a note that the function now writes a per-IP daily counter via the
`increment_support_quota` RPC (service role) and references the migration.

Design notes baked in (do not change without reason):

- **Fail open** on any quota error (RPC down, missing env, parse failure). Rationale: the whole point of `verify_jwt = false` is that support stays reachable; a quota-infra blip must not silence it. (This is the *opposite* of estimate-water, which fails closed because each call costs real Anthropic money — call it out for the reviewer.)
- A well-formed request consumes quota even if the later Resend send fails — same trade-off estimate-water documents (prevents tight retry loops).
- `x-forwarded-for` first token = original client IP on Supabase's proxy. If absent, bucket as `"unknown"` (all such requests share one bucket — acceptable).

**Verify**: inside `supabase/functions/`: `deno lint` → exit 0. If plan 007 landed
(handler exported, `@ts-nocheck` removed): `deno check submit-support/index.ts` →
exit 0. `crypto.subtle` and `fetch` are standard in Deno; no new import or
permission is required.

### Step 3: Add rate-limit unit tests

If `supabase/functions/submit-support/index.test.ts` exists (plan 007), add cases.
The test's `fetch` stub must now branch on URL: requests to a URL containing
`/rpc/increment_support_quota` are the quota RPC; requests to
`https://api.resend.com/emails` are the send.

Cases:

1. **Under limit**: quota stub returns `new Response("3", { status: 200 })` (i.e. count 3 ≤ 10). Resend stub returns 200. → handler returns 200 `{ ok: true }`, and the Resend send WAS called.
2. **Over limit**: quota stub returns `new Response("11", { status: 200 })` (count 11 > 10). → handler returns 429 (`rate_limited`), and the Resend send was NOT called.
3. **Quota infra down (fail open)**: quota stub returns `new Response("err", { status: 500 })` (or throws). Resend stub returns 200. → handler still returns 200 `{ ok: true }` and the Resend send WAS called.
4. **Distinct IPs don't share a bucket** (optional, if easy): assert the RPC body's `p_ip_hash` differs for two requests with different `x-forwarded-for` headers, and is stable for the same IP.

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` via `Deno.env.set` in these
tests so the quota branch is exercised (the existing plan-007 happy-path test runs
without them set, so its quota branch is skipped — keep it that way, or set them
and add a default quota stub; either is fine, just be consistent).

**Verify**: inside `supabase/functions/`: `deno test --allow-env` → all pass
(plan 007's cases + these).

If `index.test.ts` does NOT exist (plan 007 not landed), either create a minimal
version covering at least cases 1-3 above, or note in your report that tests are
deferred to plan 007 — do not leave the new behavior wholly untested without
saying so.

### Step 4: Confirm the local migration round-trips

**Verify**: `supabase db reset` again from scratch → the
`add_support_submission_quota` migration applies cleanly in order.
`supabase migration list` → the new version appears under **Local**. (Remote stays
blank — the human runs `supabase db push`.)

## Test plan

- Deno unit tests (Step 3): the load-bearing cases are #2 (over-limit returns 429 and does NOT send) and #3 (fail-open keeps support reachable during a quota outage).
- The migration is validated by `supabase db reset` replaying it locally with no error.
- Post-merge, after the human pushes the migration: a manual check from the live Support page (submit once → arrives; the limit is 10/day so you won't trip it in normal testing) confirms the wiring end-to-end. Note this in the PR.

## Done criteria

ALL must hold:

- [ ] New migration `supabase/migrations/<ts>_add_support_submission_quota.sql` exists; `supabase db reset` applies it with no error
- [ ] The migration creates `support_submission_quota` (RLS enabled, no policies) and `increment_support_quota(text)` (SECURITY DEFINER, execute granted only to `service_role`)
- [ ] submit-support hashes the client IP and calls `increment_support_quota` via the service role before sending; returns 429 when the count exceeds `SUPPORT_DAILY_LIMIT`; fails OPEN on any quota error
- [ ] The stale "No database writes" header comment is corrected
- [ ] Input validation, honeypot, escaping, and the Resend payload are otherwise unchanged
- [ ] Inside `supabase/functions/`: `deno lint` exits 0; `deno test --allow-env` passes (including the over-limit and fail-open cases); `deno check submit-support/index.ts` exits 0 if plan 007 has landed
- [ ] `git status` shows only the migration, the handler file, and the test file changed
- [ ] `supabase db push` was NOT run (human gate)
- [ ] `plans/README.md` status row updated, with a note that the migration awaits the human `db push`

## STOP conditions

Stop and report back (do not improvise) if:

- `supabase db reset` errors on the new migration (SQL bug, name/order collision).
- The PostgREST RPC response shape isn't a bare scalar number (e.g. it returns `[{...}]`) — adjust the parse, but if it's ambiguous, report what it actually returns rather than guessing.
- submit-support/index.ts has drifted in a way the drift-check note didn't anticipate.
- You find yourself needing to change `verify_jwt`, the input validation, or the Resend payload to make the quota work — that means the gate is in the wrong place; re-read Step 2.
- Removing/altering the honeypot seems necessary — it isn't; the honeypot stays and runs before the quota.

## Maintenance notes

- **The human must `supabase db push` this migration before the new function code is deployed**, otherwise the RPC 404s — but because the function fails OPEN, a missing RPC degrades to "no rate limiting" rather than breaking support. Deploy order is therefore forgiving, but push the migration promptly.
- **Unbounded table growth**: like `estimate_water_quota`, this table gains a row per (ip_hash, day) and has no cleanup. If it grows large, add a scheduled `delete from support_submission_quota where day < current_date - interval '30 days'`. Deferred — matches the existing estimate-water pattern.
- **Tuning**: `SUPPORT_DAILY_LIMIT = 10` is a guess. If real users on shared office/CGNAT IPs hit it, raise it; if abuse appears in the Resend logs, lower it or add a shorter window (per-hour). The limit is a single constant in the handler.
- **Reviewer**, scrutinize: (1) the quota gate sits AFTER validation+honeypot and BEFORE the send; (2) it FAILS OPEN (deliberate, opposite of estimate-water — confirm that's intended); (3) the RPC is service-role-only and the table has no RLS policies; (4) no raw IP is stored (only the SHA-256 hash).
- This is IP-based and therefore evadable by distributed attackers / XFF spoofing. If support spam becomes a real problem, the next escalation is a proof-of-work or CAPTCHA on the form, or moving the endpoint behind a WAF/Turnstile — a separate, larger effort.
