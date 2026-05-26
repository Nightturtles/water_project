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
npm run screenshots:ios       # iPhone 15 Pro Max (6.7") + iPhone 14 Plus (6.5")
npm run screenshots:android   # Pixel 6
npm run screenshots           # both
```

Each run writes PNGs under `store/screenshots/<platform>/<device>/<NN-scene>.png`. The directory is gitignored except for this README; published screenshots live on App Store Connect and Play Console, not in the repo.

## Sizes

| Platform | Device | Resolution | Store requirement |
|---|---|---|---|
| iOS | iPhone 15 Pro Max | 1290 × 2796 | 6.7" — REQUIRED for App Store submission |
| iOS | iPhone 14 Plus | 1284 × 2778 | 6.5" — optional, accepted as the older-template fallback |
| Android | Pixel 6 | 1080 × 2400 | Phone screenshots — at least one required for Play Console |

The 1024 × 500 Play Store feature graphic is NOT script-generated; it's a Figma export. See `store/android/full-description.md` for the launch-graphic source link once it exists.

## Five canonical scenes

Identical across all platforms so the store listings tell the same story.

| ID | Scene |
|---|---|
| `01-calculator` | Calculator with a recipe loaded (everyday pour over) |
| `02-library` | Recipe library browser showing public recipes |
| `03-minerals` | Mineral selector with multiple minerals enabled |
| `04-recipe-builder` | Recipe builder mid-edit |
| `05-signed-in-nav` | Signed-in state with the Delete account button visible (proves to reviewers that the in-app deletion path exists, which Apple Guideline 5.1.1(v) requires) |

Edit `scripts/capture-screenshots-shared/seed.js` to change what each scene displays. Re-run the capture script to regenerate.

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
