# Smoke: multi-device sync — save-on-navigate, push-then-pull, Realtime

**Scope**: Catches the class of bugs fixed in commits 6d8cd63 (push-then-pull init), 6464fdb (save-on-navigate reliability), 9f89a2e (cross-device delete), and the migration-012 / sync.js Realtime work that makes recipes propagate across signed-in devices within ~2 s without reload. These are the highest-blast-radius bugs the project has shipped — every regression here costs user data.

**Requires**: Two distinct browser contexts (simulating two devices) signed in as the **same** Supabase user. Playwright MCP supports multiple contexts within one run; use `browser.newContext()` twice.

## Pre-flight

1. Start dev server or target `https://cafelytic.com`.
2. Have a test account's email/password ready.

## Steps

### 1. Sign in on Device A
- Context A: open `/login.html`, sign in.
- Navigate to `/recipe.html`.
- Assert the signed-in affordances are present (logout button visible, no sign-in CTA).

### 2. Create a recipe on Device A
- Enter a recipe — set `#src-calcium` = `42`, pick a profile, change volume.
- Click "Save Changes" / `#source-save-changes-btn`. Note the profile name in the save status.

### 3. Save-on-navigate reliability (commit 6464fdb)
- Immediately after saving on Device A, navigate to `/` (don't wait — this is testing the race condition).
- Reload `/recipe.html`.
- Assert the recipe values (`#src-calcium` = `42`, the profile) are still present. Regression → the navigation drop-kicked the in-flight save.

### 4. Cross-device read (commit 6d8cd63: push-then-pull initSync)
- Context B: open `/login.html`, sign in as the same user.
- Navigate to `/recipe.html`.
- Assert `#src-calcium` = `42` (what Device A saved).
- **Key regression guard**: if Device B shows defaults instead of Device A's data, initSync is pulling-then-pushing (overwriting remote with local stale state) instead of push-then-pull. This was the bug in commit 6d8cd63.

### 5. Cross-device delete does not nuke other devices (commit 9f89a2e)
- Context A: delete a profile the user created.
- Context B: reload `/recipe.html`.
- Assert only the profile deleted on A is gone; all other user profiles are still present on B.

### 6. Concurrent edits
- Context A and B: within ~5 s of each other, each edit a *different* profile.
- On **both** contexts, poll until the save-status element for the edited section reads `Saved!` (emitted by `showSourceSaveStatus`/`showRecipeSaveStatus` once the local persist + cloud push both resolve). Use Playwright's `page.locator('#source-save-status, #recipe-save-status, #target-save-status').filter({ hasText: 'Saved!' }).first().waitFor({ timeout: 15000 })`. Failing this wait within 15 s is itself a regression — surface that as the assertion failure, not a timeout.
- Reload both. Assert both edits are present on both devices — last-writer-wins should only apply at the same-profile level.

**Codified note**: Step 6 is intentionally NOT in `smoke-sync.spec.ts`. The race is Supabase read-replica lag, and it affects every cross-device read primitive we tried (broadcast-triggered `pullFromCloud`, reload-triggered initSync pull, direct Supabase `SELECT`): PostgREST can route any request to a lagging replica that hasn't seen the recent write, returning stale data. A codified test can't deterministically wait for "the replica B's next pull happens to hit has caught up," so any spec we write either fails sporadically (which `--retries=1` would mask, diluting the signal of the rest of the codified subset) or relies on a fixed timeout long enough to be cargo-cult. PR #86's dirty-tracking makes the race non-destructive — cloud state is correct (A's push did commit), the next sync cycle detects the localStorage/cloud mismatch, and a reload recovers — so the manual UX walk above is the appropriate gate. If you ever see *cloud state* diverge (A's edit missing from `target_profiles` after the dust settles) or *both reloads* show stale data, that's a real regression, not the known race.

## Realtime propagation (migration 012, sync.js Realtime channel)

Steps 7–12 cover the change that makes adds/edits/deletes appear on the other device **within ~2 s without reload**, plus automatic recovery when the Realtime channel drops. Before commit ca89ae9 + migration 012, every assertion below would have required a manual reload on Device B.

The propagation budget per assertion is **~2 s**: 250 ms `scheduleRealtimePull` debounce + a Supabase Realtime round-trip + the dispatched `cw:cloud-data-changed` re-render. Use `waitFor({ timeout: 4000 })` to give the network the slack it needs without masking a regression.

### 7. Add-from-library propagates to the other device's rail
- Context A: navigate to `/library.html`. Confirm the recipe browser mounts (`main#rx-root` populated, `.rx-recipe-card` cards visible).
- Context B: navigate to `/index.html`. Wait for `.profile-btn` to render. Snapshot the list of `data-profile` slugs into `bSlugsBefore`.
- Context A: pick a non-starter library card whose slug is **not** in `bSlugsBefore`. Click its `.rx-recipe-card-bookmark` (the heart). The button's `aria-label` flips from "Save recipe" → "Unsave recipe".
- Context B: **without reloading**, wait for `.profile-btn[data-profile="<slug>"]` to appear. Timeout 4 s.
- Regression guard: if Context B's rail still doesn't have the slug after 4 s but a manual reload makes it appear, the Realtime subscription isn't firing → check `subscribeToCloudChanges` ran (look for `[sync] realtime channel status: ...` warnings) and that migration 012 added the table to `supabase_realtime`.

### 8. Edit propagates to the other device's library card
- Context A: on `/library.html`, find a recipe the test user owns (the card has the `.rx-recipe-card-owner-actions` block visible). Note its current `.rx-recipe-card-title` text as `originalLabel`.
- Context B: navigate to `/library.html`. Wait for the same recipe card by slug. Confirm its `.rx-recipe-card-title` reads `originalLabel`.
- Context A: click the `Edit` button (`.rx-recipe-card-owner-btn` with text "Edit"). The modal `.rx-edit-overlay` opens. Replace the name (`.rx-edit-input` first instance — `nameInput`) with `originalLabel + " (edited)"`. Click `.rx-edit-save`. Wait for the modal to close.
- Context B: **without reloading**, wait for the matching card's `.rx-recipe-card-title` to read `originalLabel + " (edited)"`. Timeout 4 s.
- Cleanup: rename it back so re-runs are clean.

### 9. Delete propagates to the other device's rail
- Context A: navigate to `/index.html`. Click `#target-edit-mode-btn` to enter edit mode. The custom-recipe buttons gain a `.preset-delete` × handle.
- Context B: on `/index.html`, snapshot the list of `data-profile` slugs into `bSlugsBefore`.
- Context A: pick a custom-only profile (one created by this test user, not a canonical starter). Click its `.preset-delete[data-delete="<slug>"]`. Confirm the deletion when the confirm-dialog appears.
- Context B: **without reloading**, wait for `.profile-btn[data-profile="<slug>"]` to disappear. Timeout 4 s.
- **Resurrection regression guard** (this is the load-bearing assertion): after Step 9 succeeds, do NOT reload. On Context B, assert all three:
  - `await page.evaluate(() => loadCustomTargetProfiles()[<slug>] || null)` returns `null` (B's local custom dict cleared by pullFromCloud's empty-array-is-authoritative branch).
  - `await page.evaluate(() => loadDeletedTargetPresets().includes(<slug>))` returns `true`.
  - Force a push: `await page.evaluate(() => window.syncNow())`, then query Supabase: `await window.supabaseClient.from('target_profiles').select('slug').eq('user_id', userId)` returns `[]`. **If the row reappears, the resurrection bug is back** — the upsert filter in `syncCustomProfiles` and/or pullFromCloud's empty-clear regressed.

### 10. Survive A going away while B keeps changing
- Context A: on `/index.html`, note the current target preset name as `aPresetBefore`.
- Context A: close the page (`context.close()` or navigate to `about:blank` — this triggers the `pagehide` handler that calls `unsubscribeFromCloudChanges` + `flushPendingSync`).
- Context B: on `/index.html`, edit a recipe (rename, change calcium, click save).
- Context A: re-open `/index.html` in a fresh page. Wait for the rail to render. The new label/value from B should be present immediately after `initSync` runs (push-first-then-pull-then-subscribe). No "Saved!" indicator needed — just assert the label.
- This catches the case where the channel teardown leaks (next subscribe rejects "channel already exists") or `initSync` skips re-subscribing.

### 11. Edit-modal guard — A's open modal survives B's edit of the same recipe
- Context A: on `/library.html`, click `Edit` on an owner-recipe card. The modal `.rx-edit-overlay` is open. Type a new value into `.rx-edit-input` but do NOT click Save.
- Context B: on `/library.html`, edit the **same** recipe — change a different field (e.g. the description), Save, close. The change pushes to Supabase.
- Context A: assert the edit modal is still open, `.rx-edit-overlay` is still in the DOM, and the in-progress text in `.rx-edit-input` is what A typed (not B's value, not blank). The deferred re-render is gated by `window._cwEditModalOpenSlug` set in `openEditRecipeModal`.
- Context A: cancel the modal (`.rx-edit-cancel`). After close, `_cwEditModalOpenSlug` is `null`, and a follow-up `cw:cloud-data-changed` (from any storage event) re-renders the rail. Confirm B's description change is now visible on A's card without reload.

### 12. Realtime auto-reconnects after a channel drop (sync-hardening)
- Context B: on `/index.html`, confirm Realtime delivery is live (a Step 7-9 change from A lands without reload).
- Drop B's connection so the channel fails rather than closes cleanly: `await contextB.setOffline(true)`, wait ~10 s for the channel to emit `TIMED_OUT` / `CHANNEL_ERROR` (console shows the one-time `[sync] realtime channel status (...)` warning), then `await contextB.setOffline(false)`.
- Context A: make a change (rename a recipe + save, or add-from-library) so a fresh Realtime event is emitted.
- Context B: the change appears within a few seconds **without a reload** — confirming the channel resubscribed (capped exponential backoff, first retry ~1 s). Before this fix a `TIMED_OUT` was only logged and updates stopped arriving until a manual reload. (Note: a clean `unsubscribe()` emits `CLOSED`, which we deliberately do NOT reconnect on — only genuine failures resubscribe, so use the offline toggle here.)

## Post-run cleanup

Steps 7-12 create or mutate recipes the test user owns. The codified `smoke-sync.spec.ts` cleans up `smoke-*` slugs automatically via [`cleanupStaleJunk`](smoke-sync.spec.ts) (prefixes: `smoke-`, `smoke5-`, `smoke6-`), but **manual walks must clean up explicitly** — there's no automated sweep for ad-hoc names (`runbook-8-<tag>`, `mobiletest-*`, etc.).

Before signing out, on the test user:

1. List recent activity:
   ```sql
   SELECT id, slug, label, is_public, updated_at
   FROM target_profiles
   WHERE user_id = :USER_ID
   ORDER BY updated_at DESC LIMIT 30;
   ```
2. **Critical**: delete every row with `is_public = true` that this run created or touched. Public rows are visible to every user at cafelytic.com/library.html — leaving them turns the public library into a graveyard. If a step in this runbook involved clicking a Share/Publish button, the resulting row will be public and MUST be deleted.
3. Also delete any private rows created during the run. The test account isn't meant to hold permanent recipes.
4. Delete by primary key (safer than `LIKE` patterns):
   ```sql
   DELETE FROM target_profiles WHERE id IN ('<uuid>', '<uuid>', ...);
   ```
5. Re-run the SELECT to confirm the rows are gone.

## Exit criteria

- All twelve steps pass.
- No "sync error" toasts in the save-status elements on either device.
- No console errors on either context. Warnings about `[sync] realtime channel status: SUBSCRIBED` are fine. A `CHANNEL_ERROR` / `TIMED_OUT` warning is acceptable ONLY when intentionally induced in Step 12 (offline simulation) and the channel then recovers (updates resume without reload); an unexpected one outside Step 12, or one that never recovers, is a failure.
- Sentry Feed shows no new issues tagged with the sync code paths (`sync.js`, `storage.js`).
- localStorage on both contexts is in sync with Supabase — for each Playwright context, `await page.evaluate(() => Object.keys(localStorage).sort())` and assert the two arrays are deep-equal.
- After each Realtime step, `await page.evaluate(() => loadCustomTargetProfiles())` returns the same dict on both contexts (the JSON.stringify of which should be deep-equal). This is the strict "always identical" check from the user requirement.

## Known limits

- This runbook does *not* cover the anonymous-to-signed-in migration path. Add a dedicated runbook for that flow if we ship changes there.
- Recipe-library operations (share, unshare, copy) are out of scope for this runbook; see [`smoke-library.spec.ts`](smoke-library.spec.ts) for those checks.
