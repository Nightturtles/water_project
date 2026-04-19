# Smoke: recipe.html — Recipe Builder

**Scope**: Auto-save on "Done Editing" and the **creator-gated share prompt** flow (commit ae7376e). These have regressed before — this runbook is designed to catch that specific class of bug.

**Requires**: A test Supabase account with at least one recipe the signed-in user is the creator of, and one saved-from-library recipe where they are *not* the creator. See `SENTRY_SETUP.md` §"Test accounts" once that section exists, or improvise with two fresh test accounts.

## Pre-flight

1. Start dev server (`preview_start` → `dev`) or target `https://cafelytic.com`.
2. Sign in via `/login.html` with the creator test account.

## Steps

### 1. Page loads
- Navigate to `/recipe.html`.
- Assert `<h1>` contains `Recipe Builder`.
- Console: zero errors.

### 2. Sections render
- `<h2>Base Water`, `<h2>Brew Method`, `<h2>Add Minerals`, `<h2>Final Water Profile` — all visible.

### 3. Auto-save on Done Editing (commit ae7376e)
- Click the source edit-mode toggle: button `#source-edit-mode-btn` (label "Edit Starting Water" → "Done Editing").
- Change `#src-calcium` to a non-default value (e.g. `15`).
- Click `#source-edit-mode-btn` again (now labeled "Done Editing").
- Assert `#source-save-status` shows a confirmation string within 2 s.
- **Reload the page** (`window.location.reload()`).
- Assert `#src-calcium` reloads with the new value — **not** the original default. A regression here means the save-on-navigate fix broke.

### 4. Creator-gated share prompt (commit ae7376e)
- On a recipe where the **signed-in user is the creator**:
  - Trigger a save (edit any mineral input + click "Save Changes" / `#source-save-changes-btn`).
  - Assert `#share-prompt-overlay` becomes visible (not `display:none`).
  - Assert `#share-prompt-title` text starts with `Share this recipe`.
  - Dismiss with `#share-prompt-no`.
- On a recipe where the **signed-in user is NOT the creator** (saved from library):
  - Trigger the same save flow.
  - Assert `#share-prompt-overlay` stays hidden — **this is the regression guard**. If the prompt shows on a non-creator edit, fail.

### 5. Base Water volume controls
- Change `#volume` and `#volume-unit`; assert the Final Water Profile recalculates (values in the final section change).

### 6. No stray Sentry errors
- After running steps 1–5, check Sentry Feed filtered to the last 5 minutes — no new issues should appear with `recipe.html` in the URL tag.

## Exit criteria

- All assertions pass.
- Creator-gated logic is observed to behave differently for creator vs. non-creator accounts.
- No uncaught exceptions in console or Sentry.
