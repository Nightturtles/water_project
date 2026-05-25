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
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

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
}

function initStatusBar(): void {
  StatusBar.setStyle({ style: Style.Default }).catch(() => {});
  StatusBar.setBackgroundColor({ color: NATIVE_BG }).catch(() => {});
}

function hideSplashAfterPaint(): void {
  requestAnimationFrame(() => {
    SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
  });
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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  // Only consume URLs that match the exact auth-callback shape. The
  // cafelytic:// scheme may grow other entry points in future PRs
  // (cafelytic://recipe/<slug>, cafelytic://share/..., etc.); without
  // this gate the handler would try to read tokens/code from those and
  // either no-op silently or worse, send unrelated query params to
  // Supabase. parsed.hostname carries the host segment of a custom-scheme
  // URL, so "cafelytic://auth-callback?code=..." -> hostname "auth-callback".
  if (parsed.protocol !== "cafelytic:" || parsed.hostname !== "auth-callback") {
    return;
  }

  // Implicit-grant OAuth lands in the hash fragment:
  //   cafelytic://auth-callback#access_token=...&refresh_token=...&type=...
  const hashParams = parsed.hash ? new URLSearchParams(parsed.hash.replace(/^#/, "")) : null;
  const accessToken = hashParams?.get("access_token") || null;
  const refreshToken = hashParams?.get("refresh_token") || null;
  const hashType = hashParams?.get("type");

  // PKCE / password-recovery emails land in the query string:
  //   cafelytic://auth-callback?code=...&type=recovery
  const code = parsed.searchParams.get("code");
  const queryType = parsed.searchParams.get("type");

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

  // Navigate to reset-password.html with #type=recovery so its
  // isRecoveryHash() fallback fires immediately on the next page load —
  // the PASSWORD_RECOVERY event from the SDK has already been delivered to
  // the previous page's listener at this point and won't re-fire on
  // subscription from the new page.
  if (isRecovery && !window.location.pathname.endsWith("reset-password.html")) {
    window.location.href = "reset-password.html#type=recovery";
  }
}
