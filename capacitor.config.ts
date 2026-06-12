import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cafelytic.app",
  appName: "Cafelytic",
  webDir: "dist",
  // server.url is intentionally absent — production builds must load the
  // bundled dist/ via file://, not a hosted URL. Setting server.url turns
  // the native app into a thin WebView shell over cafelytic.com, which
  // (a) defeats offline, (b) fails Apple 4.2, and (c) re-opens the CDN
  // load-order issues PR h just fixed.
  plugins: {
    SplashScreen: {
      // The splash must outlive the cold-start JS parse (a fresh install
      // spends multi-second parsing the legacy-globals bundle with no warm
      // WebView caches, and nothing can paint until that finishes).
      // hideSplashAfterPaint() in src/lib/capacitor-bootstrap.ts dismisses
      // the splash as soon as the page can paint, so launchShowDuration is
      // only the watchdog ceiling: if the web layer dies before calling
      // hide(), launchAutoHide tears the splash down at 6s instead of
      // leaving it stuck forever.
      //
      // launchShowDuration MUST be nonzero: both native implementations
      // short-circuit showOnLaunch() when it is 0 and never create the
      // splash view at all, turning the manual hide() into a no-op and
      // leaving the cold-start gap as a blank themed screen (the "dark
      // screen on first install" bug).
      launchShowDuration: 6000,
      launchAutoHide: true,
      // Android 12+ ignores hide()'s fadeOutDuration for the launch splash;
      // the exit fade comes from this option instead. Matches the 200ms
      // fade hideSplashAfterPaint() requests on iOS.
      launchFadeOutDuration: 200,
      backgroundColor: "#fafaf7",
      // CENTER_CROP scales the 2732x2732 splash PNG to fill the screen
      // (cropping the excess in the short dimension) instead of the
      // plugin's default FIT_XY, which would stretch the square source
      // into the device aspect ratio and distort the centered Ca tile.
      // The tile sits well within the central third of the source so it
      // survives the crop on every aspect ratio. iOS uses scaleAspectFill
      // via LaunchScreen.storyboard for the equivalent behavior.
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DEFAULT",
      // Android-only. iOS reads UIViewControllerBasedStatusBarAppearance
      // from Info.plist and the bar color from the WebView's safe-area
      // background.
      backgroundColor: "#fafaf7",
    },
  },
};

export default config;
