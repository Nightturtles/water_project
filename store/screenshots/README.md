# Store screenshots

PNGs generated from the production web build at the resolutions Apple App Store and Google Play Console require for listing artwork.

## Why these aren't taken from booted simulators

The original plan called for `xcrun simctl io ... screenshot` (iOS) and `adb exec-out screencap -p` (Android) against running native shells. We chose Playwright headless against `vite preview` instead. Reasons:

- The Cafelytic native shell is a WKWebView (iOS) and WebView (Android) wrapping the same `dist/` bundle. To a store reviewer the rendered pixels are identical at the same viewport size. Both stores actually require listing screenshots to be free of device-frame chrome (status bars, home indicators), which Playwright produces by default.
- Seeding canonical localStorage state on a booted simulator requires either manual navigation between captures or a new screenshot-mode deep-link handler in the app. Both expand PR 7's scope materially. Playwright's `page.addInitScript` handles seeding in two lines.
- Playwright is already a dev dependency. The simulator approach would have added an Xcode + Android SDK requirement (~20 GB local install for iOS alone) for every contributor who runs the screenshot job.
- The native CI workflow (`.github/workflows/native.yml`) still compile-checks the actual native shells, so we're not blind to native regressions; that's just a separate concern from listing artwork.

## Capture

```bash
npm run build                 # screenshots read from dist/ via vite preview
npm run screenshots:ios       # iPhone 15 Pro Max (6.7") + iPhone 14 Plus (6.5") + iPad Pro 12.9"
npm run screenshots:android   # Android phone, 1080 x 1920
npm run screenshots           # both
```

Each run writes PNGs under `store/screenshots/<platform>/<device>/<NN-scene>.png`. The directory is gitignored except for this README; published screenshots live on App Store Connect and Play Console, not in the repo.

## Sizes

| Platform | Device | Resolution | Store requirement |
|---|---|---|---|
| iOS | iPhone 15 Pro Max | 1290 × 2796 | 6.7" — REQUIRED for App Store submission |
| iOS | iPhone 14 Plus | 1284 × 2778 | 6.5" — optional, accepted as the older-template fallback |
| iOS | iPad Pro 12.9" | 2048 × 2732 | 12.9" — required tablet set for the Universal build |
| Android | Phone (360 pt wide) | 1080 × 1920 | Phone screenshots: Play needs at least two, with the long side at most 2.3 times the short side. 9:16 at 1080 px or more is the shape it asks for to recommend an app |

The 1024 × 500 Play Store feature graphic is NOT script-generated; it is made by hand. The listing assets (feature graphic, 512 px icon) are kept locally in the gitignored `store/screenshots/android/listing/` folder, not in the repo.

## Five canonical scenes

Identical across all platforms so the store listings tell the same story. Every scene is the same demo account, signed in: the script answers the app's sign-in checks itself (no real account, no credentials) and writes the account's data into the `cw_*` localStorage keys the app reads. Most scenes are scrolled to the part of the page that shows that data, because a phone viewport only reaches a page's first card.

| ID | Scene |
|---|---|
| `01-calculator` | Calculator with the account's saved recipe ("Sunday Brew") selected and the doses for one gallon worked out |
| `02-library` | Recipe Library showing the official catalog |
| `03-minerals` | Settings: the mineral selector with four minerals enabled |
| `04-recipe-builder` | Recipe Builder mid-edit: grams typed in for the same four minerals, with the resulting water below |
| `05-delete-account` | Settings, signed in, scrolled to the Delete account section (proves to reviewers that the in-app deletion path exists, which Apple Guideline 5.1.1(v) requires) |

Edit `scripts/capture-screenshots-shared/seed.cjs` to change the demo account. Re-run the capture script to regenerate. Each scene waits for its seeded data to be on screen and the run fails if it is not, so a renamed storage key or selector stops the run instead of capturing the page's default state.

The Library scene reads the official recipe catalog live from Supabase (the public read any visitor's page load makes), so it needs network access and shows the catalog as it is that day. Recipes published by users are left out, so no user's recipe or display name ends up on a store listing. Every other Supabase request is blocked: a capture run cannot sign in, sync, or write anything.

An output folder from before this scene list changed may still hold `05-signed-in-nav.png`. Delete it; the script does not remove files it no longer writes.

**Known gap:** the seed is currently not applied. `scripts/capture-screenshots.mjs` writes it under `cafelytic:*` storage keys, and the app reads only `cw_*` keys (`src/lib/storage-keys.ts`), so every scene captures its page's default, signed-out state. Scene `05-signed-in-nav` is also out of date: Delete account now lives on the Settings page (`minerals.html`), not in the nav, and the scene loads the Calculator. Until both are fixed (the script seeds the real keys, and scene 05 loads the Settings page signed in), treat its output as page-default captures and take the store screenshots by hand.

## Verifying

Before uploading to the stores:

1. Eyeball at least one PNG per device. Confirm the recipe content is what you want a reviewer to see.
2. Open the largest iOS image in Preview and check that no debug overlays or staging banners are visible.
3. For Android, confirm the status bar is absent (Playwright doesn't render one, but the alternate workflow below does).

## If you need actual device screenshots later

If a store reviewer rejects the Playwright captures and demands true device screenshots (very unusual for a calculator), the fallback is:

1. Wire a screenshot-mode deep-link handler in the app (e.g. `cafelytic://screenshot?scene=01`) that seeds localStorage and navigates without UI chrome.
2. Add `scripts/capture-screenshots-device.sh` that loops over `xcrun simctl io` and `adb exec-out screencap` for each scene, sending the deep link via `xcrun simctl openurl` and `adb shell am start`.
3. Keep the Playwright path as the fast iteration loop; use the device path only for final pre-submission captures.

This is a Phase B PR if it's ever needed.
