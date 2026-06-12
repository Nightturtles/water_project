# Handoff: native cold-start "dark screen" on first launch

Status: **SOLVED** (branch `fix/native-splash-show-on-launch`, 2026-06-12). The
original problem statement and investigation history are preserved below the
resolution for context.

## Resolution

### Root cause

`capacitor.config.ts` had `launchShowDuration: 0, launchAutoHide: false`,
intended as "hold the splash until we hide it manually." But **both** native
implementations of `@capacitor/splash-screen` (v8.0.1) short-circuit when the
duration is 0 and never create the splash view at all:

- iOS: `SplashScreen.swift` -> `showOnLaunch()` returns before `showSplash()`
  when `config.launchShowDuration == 0`.
- Android: `SplashScreen.java` -> `showOnLaunch()` has the identical
  `if (config.getLaunchShowDuration() == 0) return;`.

So there was never a held splash. The "dark screen" was the empty
`isOpaque = false` WKWebView showing the dark-navy `cafelyticBackground`
(#0f172a) for the entire cold bundle parse. Every observation in the original
investigation follows from this:

- The splash "rendered dark instead of the Ca image" because there was no
  splash; the dark thing was the WebView background.
- The JS `SplashScreen.hide()` call was always a silent no-op:
  `hideSplash()` early-returns on `!isVisible`.
- Attempt 1 (hold the splash longer) just held the dark WebView longer.
- Attempts 2-3 (web overlay) could never work: WebKit gets no paint
  opportunity between finishing the HTML parse and synchronously executing
  the deferred module bundle, so no DOM content - overlay included - can
  appear during the gap. First paint *is* the thing being waited on.

### Fix

1. `capacitor.config.ts`: `launchShowDuration: 6000` + `launchAutoHide: true`
   + `launchFadeOutDuration: 200`. Nonzero duration makes the splash actually
   show; it is a watchdog ceiling, not a hold time - the JS hide dismisses
   the splash at first paint (measured ~1s after WebView start on a warm
   simulator). Auto-hide at 6s only fires if the web layer dies, so a broken
   bundle can't leave the splash stuck forever. The 200ms
   `launchFadeOutDuration` is required for the fade on Android 12+, which
   ignores `hide()`'s `fadeOutDuration` for the launch splash.
2. `src/lib/capacitor-bootstrap.ts` -> `hideSplashAfterPaint()`: still hides
   on `requestAnimationFrame` (so the splash fades into a rendered page), but
   now with a 250ms `setTimeout` fallback. On Android 12+ the held launch
   splash works by suspending the view hierarchy's first draw (`onPreDraw`
   returns false until `hide()` releases it), and rAF may never fire while
   drawing is suspended - without the fallback, splash and page would
   deadlock waiting on each other.

Load-time impact: none on the happy path. The hide fires at the same first
paint that revealed the UI before; the gap just shows the branded Ca tile
(correct light/dark variant, from the same LaunchScreen.storyboard iOS uses
for the system launch screen) instead of a dark blank.

### Verified

On the iPhone 17 Pro simulator (iOS 26), true cold install (uninstall ->
install -> first launch), dark and light mode: launch -> branded Ca splash
covers the parse gap -> 200ms fade into the fully rendered calculator. Warm
relaunch timeline (timestamped screenshots): splash up ~1.2s-2.2s after
`simctl launch`, full UI at 2.4s - i.e. the JS hide, not the 6s watchdog,
dismissed it. Android is fixed by the same config (same `== 0` short-circuit
confirmed in the plugin source); worth a one-time sanity check on an
emulator/device with a fresh install.

---

## Original problem (historical)

On a **true cold first launch of a new install** (native iOS; Android likely
the same), the app hung for ~a few seconds on a dark/black screen with no
loading indicator, then the calculator UI appeared.

**Reproduce (must be a true cold start):**
1. `npm run build && npx cap sync ios && npx cap open ios`
2. In the simulator/device, delete the Cafelytic app.
3. Reinstall (Run in Xcode) and watch the very first launch.
- A warm relaunch does NOT reproduce it (caches are warm), so always reset
  first. The hang is the cold WKWebView parsing the ~628 KB `legacy-globals`
  bundle with no warm caches.

Three attempts were made on PR #170 (closed, branch
`fix/native-splash-cold-start` kept on the remote): holding the native splash
longer, a web-layer `#app-splash` overlay, and the overlay with hardcoded
colors + a `window.__splashDebug` diagnostic. All reverted; see Resolution
for why each was doomed.

## Relevant files

- `capacitor.config.ts` - SplashScreen plugin config (the fix).
- `src/lib/capacitor-bootstrap.ts` - `hideSplashAfterPaint()` (rAF +
  fallback timeout).
- `ios/App/App/CafelyticViewController.swift` - `isOpaque = false`, themed
  `cafelyticBackground`, `cwTheme` WKScriptMessage bridge.
- `ios/App/App/Base.lproj/LaunchScreen.storyboard` - full-bleed
  `image="Splash"` (`scaleAspectFill`); the splash plugin instantiates this
  same storyboard, which is why the launch screen and held splash are
  seamless.
- `ios/App/App/Assets.xcassets/Splash.imageset/` - light + dark "Ca" PNGs.
- `android/app/src/main/res/values/styles.xml` - `AppTheme.NoActionBarLaunch`
  (`Theme.SplashScreen`), splash drawables in `drawable*/` incl. `-night`.
