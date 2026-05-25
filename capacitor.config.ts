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
};

export default config;
