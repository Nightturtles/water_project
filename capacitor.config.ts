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
