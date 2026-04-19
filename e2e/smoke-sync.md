# Smoke: multi-device sync — save-on-navigate + push-then-pull

**Scope**: Catches the class of bugs fixed in commits 6d8cd63 (push-then-pull init), 6464fdb (save-on-navigate reliability), 9f89a2e (cross-device delete). These are the highest-blast-radius bugs the project has shipped — every regression here costs user data.

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

## Exit criteria

- All six steps pass.
- No "sync error" toasts in the save-status elements on either device.
- Sentry Feed shows no new issues tagged with the sync code paths (`sync.js`, `storage.js`).
- localStorage on both contexts is in sync with Supabase — for each Playwright context, `await page.evaluate(() => Object.keys(localStorage).sort())` and assert the two arrays are deep-equal.

## Known limits

- This runbook does *not* cover the anonymous-to-signed-in migration path. Add a dedicated runbook for that flow if we ship changes there.
- Recipe-library operations (share, unshare, copy) are out of scope — those belong in `smoke-library.md` if/when we add it.
