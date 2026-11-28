// Native-only initialization for the Capacitor iOS / Android shell. Runs after
// src/lib/supabase-client.ts (see legacy-globals.ts) so window.supabaseClient
// exists when the deep-link handler fires.
//
// On the public web build (cafelytic.com), this module still imports
// @capacitor/core — the first place app code does so. That populates
// window.Capacitor, which is why isNativePlatform() in supabase-client.ts is
// now a load-bearing intercept (returns false in browsers, true inside the
// Capacitor WebView). The e2e/redirect-intercept.spec.ts spec codifies the
// browser-side guard so a future regression doesn't quietly start sending
// cafelytic:// to web users.
//
// All native side-effects (status bar styling, splash dismissal, haptics,
// share sheet, deep-link listener) gate on Capacitor.isNativePlatform(), so
// the public web continues to behave exactly as before this PR.

import {
  Capacitor,
  registerPlugin,
  SystemBars,
  SystemBarsStyle,
  SystemBarType,
} from "@capacitor/core";
import type { FirebaseAnalyticsPlugin } from "@capacitor-firebase/analytics";
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import {
  authCallbackDecision,
  noteAuthCallbackAdopted,
  verifiedCallbackTokens,
} from "./supabase-client";
import { analyticsAllowed, deviceStorage, screenNameFor } from "./usage-analytics";

// Public privacy-policy URL, registered with both app stores. Hard-coded
// rather than derived from window.location.origin because on native the
// origin is file:// and we always want the user routed to the published
// page over the network.
const PRIVACY_POLICY_URL = "https://cafelytic.com/privacy";

// Status bar background per app theme, for Android 14 and older, the only
// place the bar is a solid color (see whatIsBehindTheBars). Light matches
// the launch background in capacitor.config.ts so the bar does not change color
// on hand-off from the splash; dark matches --surface, the brand strip's color.
const STATUS_BAR_BG = { light: "#fafaf7", dark: "#1e293b" };

// Cache for nativeAnalytics(). Declared above the bootstrap() call below on
// purpose: bootstrap() runs initNativeAnalytics() during module evaluation, and
// a `let` further down the file would still be uninitialized then. The
// production bundle happens to emit it as a hoisted `var`, which hid the
// ordering; the dev server's unbundled module does not.
let nativeAnalyticsPlugin: FirebaseAnalyticsPlugin | null = null;

if (Capacitor.isNativePlatform()) {
  bootstrap();
}

function bootstrap(): void {
  initStatusBar();
  hideSplashAfterPaint();
  exposeGlobals();
  initNativeAnalytics();
  registerDeepLinkListener();
  bindPrivacyLinkInterceptor();
}

// The system bar icons must follow the app's resolved theme (data-theme on
// <html>), not the device theme: the user can pick Light in Settings on a phone
// in dark mode, and the page is what sits behind the bars. The native
// "default" style follows the device, which left white icons on a white page
// on Android. The native setting outlives page navigations, so each page only
// has to apply its own theme and then follow changes to it.
function initStatusBar(): void {
  const behind = whatIsBehindTheBars();
  // Nothing to follow: the bars sit on the device-themed window background,
  // and the default style already matches that.
  if (behind === "window") return;
  const sync = () => syncSystemBars(behind);
  sync();
  // data-theme is written by theme-init.js and applyTheme() (the Settings
  // radios, and a device theme flip while the preference is "system").
  // Watching the attribute covers every writer.
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

// What the system bars are drawn over, which decides whose theme their icons
// must match:
// - "page": iOS, and Android 15+ with WebView 140+, where the app draws edge
//   to edge and the page shows through both bars.
// - "window": Android 15+ with an older WebView. Capacitor insets the WebView
//   there (its SystemBars plugin, WEBVIEW_VERSION_WITH_SAFE_AREA_FIX), so the
//   bars show the native window background, which follows the device theme.
// - "opaque": Android 14 and older. The status bar is a solid color this file
//   sets; the navigation bar is the system's own, in the device theme.
function whatIsBehindTheBars(): "page" | "window" | "opaque" {
  if (Capacitor.getPlatform() !== "android") return "page";
  const ua = navigator.userAgent;
  const android = Number(/Android (\d+)/.exec(ua)?.[1]);
  const webView = Number(/Chrome\/(\d+)/.exec(ua)?.[1]);
  // A WebView may send the reduced User-Agent, which says "Android 10; K" on
  // every device. Only Android 16 and newer do that, so it counts as new.
  const reduced = /Android 10; K[;)]/.test(ua);
  if (!(android >= 15) && !reduced) return "opaque";
  return webView >= 140 ? "page" : "window";
}

function syncSystemBars(behind: "page" | "opaque"): void {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  // In both enums "Dark" means a dark background, so light icons.
  //
  // Both plugins are told, because on Android each re-applies the style it
  // remembers when the device theme changes: left at its default, the
  // StatusBar plugin would put the device's style back.
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  if (behind === "opaque") {
    const color = dark ? STATUS_BAR_BG.dark : STATUS_BAR_BG.light;
    StatusBar.setBackgroundColor({ color }).catch(() => {});
  }
  SystemBars.setStyle({
    style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    // Omitting `bar` styles both; an opaque navigation bar keeps the default.
    bar: behind === "page" ? undefined : SystemBarType.StatusBar,
  }).catch(() => {});
}

// Minimum splash visibility. On fast devices the page is ready ~250ms after
// the WebView starts, which made the splash blink in and out; holding it
// briefly reads as a deliberate branded intro instead. Measured from the
// WebView's navigation start (performance.now() origin), which begins
// ~200-300ms after the splash actually appears, so the on-screen time is
// slightly longer than this floor. Slow cold starts are unaffected: once the
// page takes longer than the floor, the hide fires at first paint as before.
const MIN_SPLASH_VISIBLE_MS = 1000;

function hideSplashAfterPaint(): void {
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
  };
  // Hide at first paint or at the visibility floor, whichever is later.
  const scheduleHide = () => {
    window.setTimeout(hide, Math.max(0, MIN_SPLASH_VISIBLE_MS - performance.now()));
  };
  // By the time this module runs, the document is fully parsed (classic
  // scripts execute during parse, modules after), so the first paint
  // opportunity already has the complete UI. The rAF defers the hide to
  // that paint so the splash fades into rendered content.
  requestAnimationFrame(scheduleHide);
  // Android 12+ holds the launch splash by suspending the view hierarchy's
  // first draw (onPreDraw returns false until hide() releases it), and rAF
  // may never fire while drawing is suspended -- without this fallback the
  // splash and the page would deadlock waiting on each other.
  window.setTimeout(scheduleHide, 250);
}

function exposeGlobals(): void {
  const impactStyles: Record<"light" | "medium" | "heavy", ImpactStyle> = {
    light: ImpactStyle.Light,
    medium: ImpactStyle.Medium,
    heavy: ImpactStyle.Heavy,
  };

  window.cwHaptic = (style: "light" | "medium" | "heavy" = "light") => {
    Haptics.impact({ style: impactStyles[style] || ImpactStyle.Light }).catch(() => {});
  };

  window.cwNativeShare = (opts: { title?: string; text?: string; url?: string }) => {
    Share.share(opts).catch(() => {});
  };

  // The Settings switch (mountAnalyticsSetting in ui-shared.ts) calls this so
  // a change applies to the SDK straight away, not on the next page.
  window.cwSetNativeAnalyticsEnabled = (enabled: boolean) => {
    nativeAnalytics()
      .setEnabled({ enabled })
      .catch(() => {});
  };
}

// The native half of @capacitor-firebase/analytics, looked up by the name its
// iOS and Android code registers. The package's JS entry is deliberately not
// imported (only its types are): that entry carries a web implementation built
// on the Firebase JS SDK, which the website never uses (it has gtag.js) and
// should not ship. Its cache, nativeAnalyticsPlugin, is declared at the top of
// the file.
function nativeAnalytics(): FirebaseAnalyticsPlugin {
  nativeAnalyticsPlugin ??= registerPlugin<FirebaseAnalyticsPlugin>("FirebaseAnalytics");
  return nativeAnalyticsPlugin;
}

// Usage analytics for the native apps (see usage-analytics.ts for why they do
// not use gtag.js). The SDK counts active users and sessions by itself; the one
// thing it cannot see is which page is open, because the whole app is a single
// native screen. Each page is a full document load, so one screen view here per
// load is one per page. The SDK's own screen reporting is switched off in
// Info.plist and AndroidManifest.xml, or every launch would add a second,
// unnamed view.
//
// The SDK remembers setEnabled across launches, but it is sent on every page
// anyway so the SDK can never disagree with the device's opt-out flag (which
// the `?no-analytics=1` web switch and a restored backup can also change).
function initNativeAnalytics(): void {
  const enabled = analyticsAllowed(deviceStorage());
  const analytics = nativeAnalytics();
  analytics.setEnabled({ enabled }).catch(() => {});
  if (!enabled) return;
  analytics.setCurrentScreen({ screenName: screenNameFor(location.pathname) }).catch(() => {});
}

// Intercept clicks on the in-app "Privacy policy" link and open it in
// Safari / Chrome Custom Tabs via @capacitor/browser instead of letting the
// WKWebView navigate to the URL itself. Without this, the privacy page loads
// inside the same WebView that hosts the app, which (a) traps the user
// (back button leaves them stranded), (b) makes the in-app shell look like
// an embedded clone of the website, and (c) is the kind of UX issue Apple
// reviewers explicitly call out as a reject reason. Web builds keep the
// plain <a href="/privacy"> behavior — the page exists at that URL there.
function bindPrivacyLinkInterceptor(): void {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    const link = target.closest("#privacy-link, [data-privacy-link]");
    if (!link) return;
    e.preventDefault();
    Browser.open({ url: PRIVACY_POLICY_URL, presentationStyle: "popover" }).catch((err) => {
      console.warn("[capacitor-bootstrap] Browser.open(privacy) failed:", err);
    });
  });
}

function registerDeepLinkListener(): void {
  // Cold-launch deep links can fire onUrlOpen before getSession() has
  // settled — replaying after cw:auth-state-resolved keeps the session
  // exchange running against a primed client. supabase-client.ts dispatches
  // cw:auth-state-resolved once its initial getSession() promise resolves
  // (success or failure), so this also handles the no-existing-session case.
  let supabaseReady = window._authStateResolved === true;
  const queue: string[] = [];

  document.addEventListener("cw:auth-state-resolved", () => {
    supabaseReady = true;
    while (queue.length > 0) {
      const u = queue.shift();
      if (u) void handleDeepLink(u);
    }
  });

  App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
    if (!event.url) return;
    if (!supabaseReady) {
      queue.push(event.url);
      return;
    }
    void handleDeepLink(event.url);
  });
}

async function handleDeepLink(url: string): Promise<void> {
  // Gate on a string-prefix shape rather than parsing hostname. Android
  // WebView's URL parser treats non-special schemes inconsistently —
  // some versions put "auth-callback" into pathname instead of hostname,
  // which would make a parsed.hostname check silently reject the URL.
  // The cafelytic:// scheme may grow other entry points later
  // (cafelytic://recipe/<slug>, cafelytic://share/..., etc.); the prefix
  // gate keeps unrelated URLs from running the session-exchange path
  // without depending on URL-parser quirks. Verified end-to-end on
  // Android: the same listener also receives the URL on iOS WebKit.
  if (!url.startsWith("cafelytic://auth-callback")) {
    return;
  }

  // Parse query / hash params manually so we don't rely on new URL() behavior
  // for non-special schemes. Standard ?query precedes #hash; some emails
  // ship #hash-only flows (implicit-grant OAuth) and some ship ?query
  // (PKCE / password recovery).
  const queryStart = url.indexOf("?");
  const hashStart = url.indexOf("#");
  let queryStr = "";
  let hashStr = "";
  if (queryStart >= 0 && (hashStart < 0 || queryStart < hashStart)) {
    const queryEnd = hashStart >= 0 ? hashStart : url.length;
    queryStr = url.substring(queryStart + 1, queryEnd);
    if (hashStart >= 0) hashStr = url.substring(hashStart + 1);
  } else if (hashStart >= 0) {
    hashStr = url.substring(hashStart + 1);
  }

  // Implicit-grant OAuth lands in the hash fragment:
  //   cafelytic://auth-callback#access_token=...&refresh_token=...&type=...
  const hashParams = hashStr ? new URLSearchParams(hashStr) : null;
  const accessToken = hashParams?.get("access_token") || null;
  const refreshToken = hashParams?.get("refresh_token") || null;
  const hashType = hashParams?.get("type");

  // PKCE / password-recovery emails land in the query string:
  //   cafelytic://auth-callback?code=...&type=recovery
  const searchParams = queryStr ? new URLSearchParams(queryStr) : null;
  const code = searchParams?.get("code") || null;
  const queryType = searchParams?.get("type");

  const client = window.supabaseClient;
  if (!client) return;

  let isRecovery: boolean;
  try {
    // supabase-js v2's setSession / exchangeCodeForSession do not always
    // throw on failure — without throwOnError set on the client they
    // resolve with { error } instead. Treat a non-null error the same as
    // a thrown exception so a bad token / expired code doesn't fall
    // through and navigate the recovery flow into reset-password.html
    // without an actual session.
    if (accessToken && refreshToken) {
      // Any app or web page can open a cafelytic:// link, so refuse one that
      // would swap the signed-in account for a different one this app didn't
      // start a sign-in for (see authCallbackDecision). A link claiming the
      // signed-in account must prove it before setSession sees it: setSession
      // checks an unexpired access token with the server, but when the
      // token's (unverified) exp says it has expired, or it has none, it skips
      // that check and adopts whatever account the refresh token belongs to.
      const decision = authCallbackDecision(accessToken);
      let tokens: { access_token: string; refresh_token: string } | null = {
        access_token: accessToken,
        refresh_token: refreshToken,
      };
      if (decision === "verify") tokens = await verifiedCallbackTokens(refreshToken);
      if (decision === "refuse" || !tokens) {
        console.warn("[capacitor-bootstrap] ignored a deep link for a different account");
        return;
      }
      const { error } = await client.auth.setSession(tokens);
      if (error) throw error;
      noteAuthCallbackAdopted();
      isRecovery = hashType === "recovery";
    } else if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      isRecovery = queryType === "recovery";
    } else {
      return;
    }
  } catch (err) {
    console.warn("[capacitor-bootstrap] deep link exchange failed:", err);
    return;
  }

  if (isRecovery) {
    // Navigate to reset-password.html with #type=recovery so its
    // isRecoveryHash() fallback fires immediately on the next page load —
    // the PASSWORD_RECOVERY event from the SDK has already been delivered to
    // the previous page's listener at this point and won't re-fire on
    // subscription from the new page.
    if (!window.location.pathname.endsWith("reset-password.html")) {
      window.location.href = "reset-password.html#type=recovery";
    }
  } else {
    // OAuth sign-in: the session is set, but the page that launched the flow
    // (login modal or login.html) was rendered logged-out and does not
    // re-render on a deep-link-driven SIGNED_IN, so it hangs on the logged-out
    // view until manually refreshed. Reload to pick up the session; this is the
    // native analog of the web OAuth flow's full-page redirect to login.html.
    window.location.reload();
  }
}
