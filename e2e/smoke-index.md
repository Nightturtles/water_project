# Smoke: index.html — Coffee Water Calculator

**Scope**: The primary page. Verifies the Starting Water → Target Profile → Add-to-Your-Water flow renders and updates without JS errors.

**Base URL**: `http://localhost:8080` (dev) or `https://cafelytic.com` (prod smoke).

## Pre-flight

1. Ensure a local server is running via Claude Preview MCP (`preview_start` on the `dev` config in `.claude/launch.json`). Skip for prod smoke.
2. Use Playwright MCP to open a fresh browser context (no cached localStorage).

## Steps

### 1. Page loads without console errors
- Navigate to `/`.
- Assert `<h1>` contains text `Coffee Water Calculator`.
- Read console logs — zero `error`-level entries. (A Supabase-related `error` during anonymous load is a regression; auth isn't required on index.)

### 2. Starting Water section renders
- Assert an `<h2>` with text `Starting Water` is visible.
- Assert the source profile preset buttons render (container id `source-presets`).
- Assert all 8 ion inputs render with id prefix `src-` (`src-calcium`, `src-magnesium`, `src-alkalinity`, `src-potassium`, `src-sodium`, `src-sulfate`, `src-chloride`, `src-bicarbonate`).

### 3. Target profile buttons render
- Assert an `<h2>` with text `Target Water Profile` is visible.
- Assert the profile buttons container (`profile-buttons`) has at least 3 buttons.

### 4. Volume unit toggle
- The volume input (`#volume`) + unit select (`#volume-unit`) are present.
- Change `#volume` to `2` and `#volume-unit` to a non-default option.
- Assert the "Add to Your Water" recommendations (`<h2>Add to Your Water</h2>` section) re-renders without throwing.

### 5. Theme init race
- Verify no FOUC — the theme class is applied to `<html>` before the body renders. (Inspect the dataset/className on `document.documentElement` within the first 50ms of load via `preview_eval` or Playwright `page.evaluate`.)

### 6. Sentry is wired (production only)
- Assert `window.Sentry && typeof window.Sentry.captureException === 'function'`.
- Network: confirm **any** request whose URL matches `/^https:\/\/js\.sentry-cdn\.com\//` returned `200`. Match on host, not on the specific public-key filename — the DSN may rotate.

## Exit criteria

- No console errors.
- All assertions above pass.
- No uncaught exceptions surfaced in Sentry within 30s after the run (check the Feed filtered to the last 5 minutes).
