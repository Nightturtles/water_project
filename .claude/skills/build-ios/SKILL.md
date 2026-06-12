---
name: build-ios
description: Build the web bundle and open the native iOS app in Xcode for this Capacitor project. Runs `npm run build` (Vite), then `npx cap sync ios`, then `npx cap open ios`, so the freshly built dist/ is copied into the iOS shell and Xcode opens ready to run on a simulator or device. Use this whenever the user wants to build, sync, run, test, or open the iOS or native app on a Mac, with phrasings like 'build the iOS app', 'open it in Xcode', 'run on the simulator', 'push my latest changes into the iOS build', 'rebuild the native app', or just 'build-ios'. This is the local build-and-open pipeline only and does NOT produce a signed TestFlight or App Store upload (use scripts/upload-testflight.sh for that). Only applies inside a Capacitor project that has capacitor.config.ts and an ios/ directory.
---

# build-ios

Take the latest web source, build it, sync it into the native iOS shell, and open Xcode so the user can run the app on a simulator or device.

This is a Capacitor project: the iOS app is a thin native wrapper that loads the bundled `dist/` over `file://`. The iOS app only reflects web changes after `dist/` is rebuilt and `cap sync` copies it across — that is the whole reason this three-step sequence exists.

## Before you start

Run from the Capacitor project root, the directory that contains `capacitor.config.ts` and an `ios/` folder. If you don't see both, you're either in the wrong directory or this isn't a Capacitor project — say so instead of running the commands. iOS builds need macOS with Xcode installed (`xcode-select -p` should resolve to a path).

## Steps

Run these three commands in order, from the project root:

```bash
npm run build && npx cap sync ios && npx cap open ios
```

What each does, and why the order matters:

1. **`npm run build`** — Vite builds the web bundle into `dist/`. This has to come first: `cap sync` copies whatever is currently in `dist/`, so a stale or missing `dist/` means the iOS app shows old code. If this fails it's an ordinary web/TypeScript build error — surface the Vite output, stop here, and fix the source before retrying. Never sync a build that didn't complete.
2. **`npx cap sync ios`** — copies the fresh `dist/` into the iOS project and updates native plugins/dependencies to match `package.json`. If it reports it can't find the web assets directory (`dist`), step 1 didn't produce output — re-run the build.
3. **`npx cap open ios`** — opens the iOS project in Xcode. This repo's iOS shell uses Swift Package Manager (no CocoaPods, no `.xcworkspace`), so there's no `pod install` step and `cap open ios` opens the project directly. Xcode is the endpoint: once it's open, the user drives the Run button to launch on a simulator or device. Don't try to build or drive Xcode from here.

Chaining with `&&` stops automatically at the first failure, which is exactly what you want — don't sync or open against a build that didn't finish. If you'd rather run them one at a time to inspect each step's output, that's fine too; just keep the order and stop on the first failure.

## Done when

Xcode is open with the freshly synced iOS project. Tell the user it's built, synced, and open, and that they can hit Run in Xcode to launch on a simulator or device.

## Not this skill

For a signed TestFlight / App Store build this is the wrong flow — that's `scripts/upload-testflight.sh`. This skill only builds locally and opens Xcode. Likewise, a request to *edit* iOS or native code (fix a bug, change the status bar) is normal source work, not this build-and-open pipeline.
