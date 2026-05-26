# smoke-delete-account.md — manual runbook

The codified spec at `smoke-delete-account.spec.ts` exercises the UI flow
against a stubbed Supabase client. That catches regressions in the button
wiring, the type-to-confirm modal, and the call site for the RPC. It does
NOT verify the actual server-side deletion against a real Supabase project.

Run this runbook end-to-end before any PR that touches:
- `supabase/migrations/<ts>_delete_account.sql`
- `src/components/ui-shared.ts` (showConfirm or `_updateNavAuth`)
- `src/lib/sync.ts` (`clearLocalUserContent`)
- The nav-auth area generally

## Why this runbook exists

Account deletion is irreversible. If the RPC's cascade misses a table, or
if `clearLocalUserContent` leaves a stale token behind that re-authenticates
on next load, real user data gets eaten. We can't unit-test "the row is
actually gone" against the live Supabase project without nuking a real
account, so this is a manual gate by design.

## Setup (one-time per CI run, or before pushing)

1. Decide which account to test against. **Do NOT use the account in
   `.env.test` (CAFELYTIC_TEST_*) — that's the sync-test account and other
   specs depend on it.**
2. Create a throwaway account on the live site:
   - Open https://cafelytic.com/login.html
   - Toggle to "Create account"
   - Use an email you control (e.g. `your-name+delete-test-<date>@gmail.com`)
   - Pick a password you don't reuse
   - Confirm the email when Supabase emails you
3. Sign in, save one recipe, save one custom source-water profile, set a
   theme, change one of the mineral selections. (You want non-empty data
   across every cascaded table.)
4. In the Supabase dashboard, open the SQL editor and confirm rows exist
   for this user across all five tables:

   ```sql
   select 'user_settings' as t, count(*) from public.user_settings where user_id = '<UID>'
   union all select 'source_profiles', count(*) from public.source_profiles where user_id = '<UID>'
   union all select 'target_profiles_owned', count(*) from public.target_profiles where user_id = '<UID>'
   union all select 'target_profiles_created', count(*) from public.target_profiles where creator_user_id = '<UID>'
   union all select 'user_selections', count(*) from public.user_selections where user_id = '<UID>'
   union all select 'estimate_water_quota', count(*) from public.estimate_water_quota where user_id = '<UID>';
   ```

   Note the UID (from auth.users) and the counts.

## Run

Open the app — site, iOS simulator, or Android simulator — and sign in with
the throwaway account.

### Step 1: Button visibility + copy
Open the nav (hamburger on mobile, top bar on desktop). Confirm:
- "Delete account" button appears next to "Log out"
- It's styled muted/grey, not a loud destructive red
- The button text is exactly "Delete account" (capitalization matters for
  store-review compliance checklists)

### Step 2: Confirm modal
Tap "Delete account". Confirm:
- Modal opens centered, overlay is dark
- Message text is the warning copy from `_updateNavAuth`
- Label reads "Type your email to confirm:"
- An empty input is focused
- Confirm button reads "Delete account" and is disabled
- Cancel button reads "Cancel"
- Pressing Escape closes the modal without firing
- Clicking the overlay closes the modal without firing

### Step 3: Input validation
Reopen the modal. Type variants of your email and confirm the button only
enables on an exact match (case-sensitive, whitespace-tolerant):
- `wrong@example.com` → still disabled
- Your email with one letter wrong → disabled
- Your email in uppercase (if it differs) → disabled
- Your exact email → enabled
- Trailing/leading spaces of the exact email → enabled

### Step 4: Cancel does not delete
With the button enabled (typed exact email), click Cancel instead. Confirm:
- Modal closes
- Open the Supabase SQL editor, re-run the count query from setup. All
  counts must be unchanged.

### Step 5: Confirm path
Reopen the modal, type your exact email, click "Delete account". Confirm:
- The page navigates to `index.html` (or stays on it)
- A small dark flash banner appears at the top reading
  "Your account has been deleted." It fades out after ~4 seconds.
- The nav-auth area now shows "Log in" instead of email + Log out + Delete

### Step 6: Server-side verification
In the Supabase SQL editor:

1. Confirm the auth row is gone:
   ```sql
   select count(*) from auth.users where id = '<UID>';
   -- expect 0
   ```
2. Re-run the count query from setup. Every count except
   `target_profiles_created` must be 0. The `target_profiles_created`
   count should ALSO be 0 — but if you shared any recipes with another
   account, those recipes still exist with `creator_user_id = NULL`. Run
   the alt query:
   ```sql
   select id, label from public.target_profiles where creator_user_id is null
     and label in ('<labels you remember sharing>');
   -- expect rows; creator_user_id NULL is the "Anonymous User" state
   ```

### Step 7: Cannot sign back in
Try to sign in with the same credentials. Expect:
- "Invalid login credentials" or equivalent error
- No new session created

### Step 8: Local content was wiped
Reload the home page. Confirm:
- No saved recipes appear in My Recipes
- No custom source-water profiles
- Mineral selections reset to defaults
- Theme either resets to system or stays per the device preference
  (theme is preserved by design — Category D)

### Step 9: Native browser opens privacy link (iOS + Android only)
Sign in with a different test account (don't bother creating a fresh one
just for this; use any account). On the login screen, tap the "Privacy
policy" link in the footer. Confirm:
- iOS: Safari Sheet opens with cafelytic.com/privacy in it. Closing the
  sheet returns you to the login screen.
- Android: Chrome Custom Tab opens, same behavior.
- The privacy link does NOT navigate inside the app's own WebView.

## After running

The throwaway account is gone. You can either:
- Create a new throwaway for the next run, or
- Skip the live-account portion if you're confident the spec covers what
  you changed.

## When to skip this runbook

The codified spec is sufficient if your change is purely cosmetic (CSS,
copy tweaks, button placement). Skip this runbook for those. Run it for
any change that touches the RPC, the storage clear, the sign-out path, or
the cascade-FK definitions in `supabase/migrations/`.
