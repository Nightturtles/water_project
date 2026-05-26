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
      // We hide the splash manually after first paint (see
      // src/lib/capacitor-bootstrap.ts -> hideSplashAfterPaint). Disabling
      // the launch-time auto-hide keeps the splash up until the WebView has
      // actually rendered, avoiding the flash of white that happens when
      // the WebView is still parking and the splash has already dismissed.
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: "#fafaf7",
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
