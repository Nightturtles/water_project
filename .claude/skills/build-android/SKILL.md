---
name: build-android
description: Build the web bundle and open the native Android app in Android Studio for this Capacitor project. Runs `npm run build` (Vite), then `npx cap sync android`, then `npx cap open android`, so the freshly built dist/ is copied into the Android shell and Android Studio opens ready to run on an emulator or device. Use this whenever the user wants to build, sync, run, test, or open the Android or native app, with phrasings like 'build the Android app', 'open it in Android Studio', 'run on the emulator', 'push my latest changes into the Android build', 'rebuild the native app', or just 'build-android'. This is the local build-and-open pipeline only and does NOT produce a signed Play Store upload (use scripts/upload-play-internal.sh for that). Only applies inside a Capacitor project that has capacitor.config.ts and an android/ directory.
---

# build-android

Take the latest web source, build it, sync it into the native Android shell, and open Android Studio so the user can run the app on an emulator or device.

This is a Capacitor project: the Android app is a thin native wrapper that loads the bundled `dist/` over `file://`. The Android app only reflects web changes after `dist/` is rebuilt and `cap sync` copies it across — that is the whole reason this three-step sequence exists.

## Before you start

Run from the Capacitor project root, the directory that contains `capacitor.config.ts` and an `android/` folder. If you don't see both, you're either in the wrong directory or this isn't a Capacitor project — say so instead of running the commands. Android builds need Android Studio installed (it bundles the JDK and Android SDK that Gradle needs).

## Steps

Run these three commands in order, from the project root:

```bash
npm run build && npx cap sync android && npx cap open android
```

What each does, and why the order matters:

1. **`npm run build`** — Vite builds the web bundle into `dist/`. This has to come first: `cap sync` copies whatever is currently in `dist/`, so a stale or missing `dist/` means the Android app shows old code. If this fails it's an ordinary web/TypeScript build error — surface the Vite output, stop here, and fix the source before retrying. Never sync a build that didn't complete.
2. **`npx cap sync android`** — copies the fresh `dist/` into the Android project and updates native plugins/dependencies to match `package.json`. If it reports it can't find the web assets directory (`dist`), step 1 didn't produce output — re-run the build.
3. **`npx cap open android`** — opens the Android project in Android Studio. Android Studio is the endpoint: on first open it runs a Gradle sync that can take a minute or two, after which the user drives the Run button to launch on an emulator or device. Don't try to build or drive Android Studio from here.

Chaining with `&&` stops automatically at the first failure, which is exactly what you want — don't sync or open against a build that didn't finish. If you'd rather run them one at a time to inspect each step's output, that's fine too; just keep the order and stop on the first failure.

## Done when

Android Studio is open with the freshly synced Android project. Tell the user it's built, synced, and open, and that they can hit Run in Android Studio to launch on an emulator or device (allowing for the first-open Gradle sync).

## Not this skill

For a signed Play Store build this is the wrong flow — that's `scripts/upload-play-internal.sh`. This skill only builds locally and opens Android Studio. Likewise, a request to *edit* Android or native code (fix a bug, change the splash screen) is normal source work, not this build-and-open pipeline.
