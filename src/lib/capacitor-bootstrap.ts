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

import { Capacitor } from "@capacitor/core";
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

// Public privacy-policy URL, registered with both app stores. Hard-coded
// rather than derived from window.location.origin because on native the
// origin is file:// and we always want the user routed to the published
// page over the network.
const PRIVACY_POLICY_URL = "https://cafelytic.com/privacy";

// Matches the launch background in capacitor.config.ts so the WebView paints
// the same color the splash screen was showing, avoiding a flash on hand-off.
const NATIVE_BG = "#fafaf7";

if (Capacitor.isNativePlatform()) {
  bootstrap();
}

function bootstrap(): void {
  initStatusBar();
  hideSplashAfterPaint();
  exposeGlobals();
  registerDeepLinkListener();
  bindPrivacyLinkInterceptor();
}

function initStatusBar(): void {
  StatusBar.setStyle({ style: Style.Default }).catch(() => {});
  StatusBar.setBackgroundColor({ color: NATIVE_BG }).catch(() => {});
}

function hideSplashAfterPaint(): void {
  const hide = () => SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});

  // Dismiss only once the app has actually rendered, not on the first frame.
  // A single requestAnimationFrame fires before the heavy first-launch work
  // finishes (parsing the ~630 KB bundle, then the classic scripts building the
  // UI), so on a cold start the cream splash was dropping into a blank, dark
  // WebView for a few seconds. Waiting for full load plus two painted frames
  // keeps the splash up as the loading screen until real content is on screen.
  const dismissWhenPainted = () => requestAnimationFrame(() => requestAnimationFrame(hide));
  if (document.readyState === "complete") {
    dismissWhenPainted();
  } else {
    window.addEventListener("load", dismissWhenPainted, { once: true });
  }

  // Safety net: never strand the splash if `load` somehow never fires. hide()
  // is idempotent, so this is harmless when the listener above already ran.
  setTimeout(hide, 6000);
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

  let isRecovery = false;
  try {
    // supabase-js v2's setSession / exchangeCodeForSession do not always
    // throw on failure — without throwOnError set on the client they
    // resolve with { error } instead. Treat a non-null error the same as
    // a thrown exception so a bad token / expired code doesn't fall
    // through and navigate the recovery flow into reset-password.html
    // without an actual session.
    if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
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
