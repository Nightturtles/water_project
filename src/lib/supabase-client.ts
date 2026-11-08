// Supabase client + auth helpers — bundled via Vite (was loaded from CDN as a
// classic <script> before Phase A PR h). Imported by src/lib/legacy-globals.ts
// before storage.ts and sync.ts so window.supabaseClient is populated by the
// time those modules read it. Inline HTML scripts on login.html continue to
// call the window.signInWithEmail / window.signUpWithEmail / etc. helpers
// declared below — keep their signatures stable.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  persistedSessionStorageKey,
  extractUserIdFromPersistedSession,
  decideCallbackSession,
  verifyCallbackRefreshToken,
  type CallbackDecision,
} from "./auth-session";

const SUPABASE_URL = "https://srlwgayrxzamxlodpsrq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_X_Ui23hNRO1Uss-iLVSKiQ_cLqApXFq";

// --- Auth-callback guard ----------------------------------------------------
// The client uses the implicit flow, so auth-js adopts any access/refresh
// token pair it finds in the URL hash (and capacitor-bootstrap does the same
// for cafelytic:// deep links), replacing whatever session exists. A crafted
// link carrying another account's tokens would then silently move a signed-in
// user into that account, and the first-login merge would push their local
// recipes into it. Only adopt a callback when nobody is signed in, when this
// app started an auth flow recently, or when it's proven to be for the
// signed-in account (decideCallbackSession, verifiedCallbackTokens).
const AUTH_FLOW_PENDING_KEY = "cw_auth_flow_pending_at";

function markAuthFlowPending(): void {
  try {
    localStorage.setItem(AUTH_FLOW_PENDING_KEY, String(Date.now()));
  } catch (_) {
    // Storage unavailable: a different-account callback will be refused,
    // same as an unsolicited one. Signed-out callbacks are unaffected.
  }
}

function readAuthFlowPending(): number | null {
  try {
    const raw = localStorage.getItem(AUTH_FLOW_PENDING_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

function clearAuthFlowPending(): void {
  try {
    localStorage.removeItem(AUTH_FLOW_PENDING_KEY);
  } catch (_) {
    // ignore
  }
}

function readPersistedUserId(): string | null {
  try {
    return extractUserIdFromPersistedSession(
      localStorage.getItem(persistedSessionStorageKey(SUPABASE_URL)),
    );
  } catch (_) {
    return null;
  }
}

// How an auth callback carrying `accessToken` may replace the current session
// (see decideCallbackSession). Used for both the URL-hash path below and
// native deep links (capacitor-bootstrap.ts).
export function authCallbackDecision(accessToken: string | null): CallbackDecision {
  return decideCallbackSession({
    incomingAccessToken: accessToken,
    existingUserId: readPersistedUserId(),
    pendingFlowStartedAt: readAuthFlowPending(),
    now: Date.now(),
  });
}

// A callback session was adopted: the auth flow this app started, if any, is
// done, so a different-account callback needs a new flow again.
export function noteAuthCallbackAdopted(): void {
  clearAuthFlowPending();
}

// For a "verify" callback: prove the refresh token belongs to the account
// signed in on this device. auth-js's setSession reads the access token
// without checking its signature and, when that token looks expired, adopts
// whatever account the refresh token belongs to; a crafted link could claim
// this account in the access token and carry another account's refresh token.
// So exchange the refresh token on a throwaway client (no storage, no auto
// refresh) and return the new token pair only when it's this account's.
// Refresh tokens are single-use: adopt the returned pair, not the original.
// Null when the exchange fails or the account differs. Expired access tokens
// in a legitimate link still work, since only the refresh token is used.
export async function verifiedCallbackTokens(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string } | null> {
  return verifyCallbackRefreshToken(refreshToken, readPersistedUserId(), async function (token) {
    const probe = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "cw-auth-callback-probe",
      },
    });
    const { data, error } = await probe.auth.refreshSession({ refresh_token: token });
    if (error || !data || !data.session || !data.user) return null;
    return {
      userId: data.user.id,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  });
}

// auth-js's own test for "this URL is an implicit-grant callback", gated by
// authCallbackDecision. On this path auth-js checks the access token with the
// server (getUser) before adopting it, so a "verify" callback can proceed: a
// forged token claiming this account fails there. A refused callback keeps
// the current session and the foreign tokens are dropped from the address bar.
function detectSessionInUrlGuarded(url: URL, params: { [parameter: string]: string }): boolean {
  const isImplicitCallback = Boolean(
    params.access_token || params.error || params.error_description || params.error_code,
  );
  if (!isImplicitCallback) return false;
  if (authCallbackDecision(params.access_token || null) !== "refuse") {
    if (params.access_token) noteAuthCallbackAdopted();
    return true;
  }
  try {
    history.replaceState(history.state, "", url.pathname + url.search);
  } catch (_) {
    // ignore
  }
  console.warn("[auth] ignored a sign-in link for a different account than the one signed in");
  return false;
}

// Upgrade requests to keepalive: true when the page is being backgrounded or
// unloaded. Lets in-flight pushes (from flushPendingSync) survive navigation.
// 64 KB aggregate body cap, fine for this app's payloads.
export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    detectSessionInUrl: detectSessionInUrlGuarded,
  },
  global: {
    fetch: function (url, opts) {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        opts = Object.assign({}, opts ?? {}, { keepalive: true });
      }
      return fetch(url, opts);
    },
  },
});

window.supabaseClient = supabaseClient;

// e2e/_auth-stub.ts and several spec files pin window properties
// (_cachedAuthUserId, _authStateResolved, isLoggedInSync, isLoggedIn,
// getUser) via Object.defineProperty({writable: false}) so tests can
// short-circuit auth state. The previous classic supabase-client.js was
// non-strict, so direct assignment to a pinned property silently no-op'd.
// This module is strict (ES modules always are), so a bare assignment to a
// pinned property throws — which would abort the rest of the auth-state
// callback (the cw:auth-state-resolved event would never fire, breaking
// every test that awaits it). trySet preserves the silent-fail behavior the
// stubs depend on. Applied to every window.* helper since any of them could
// be pinned by a future test.
function trySet(key: string, value: unknown): void {
  try {
    (window as unknown as Record<string, unknown>)[key] = value;
  } catch (_) {
    // Property pinned with writable:false (intentional in test stubs).
  }
}

// Native check: Capacitor (added in Phase A PR j) injects window.Capacitor
// into the WebView before any user script runs. Returning false on web is
// the only behavior this PR exercises; PR j flips this on when the iOS /
// Android shells start loading dist/.
function isNativePlatform(): boolean {
  return (
    (
      window as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.() === true
  );
}

const AUTH_CALLBACK = isNativePlatform()
  ? "cafelytic://auth-callback"
  : "https://cafelytic.com/login.html";

const RESET_CALLBACK = isNativePlatform()
  ? "cafelytic://auth-callback"
  : "https://cafelytic.com/reset-password.html";

trySet("getUser", function () {
  return supabaseClient.auth.getUser();
});

trySet("isLoggedIn", function () {
  return supabaseClient.auth.getSession().then(({ data }) => !!data.session);
});

trySet("signInWithEmail", async function (email: string, password: string) {
  return supabaseClient.auth.signInWithPassword({ email, password });
});

// The flows below land back on this app with tokens in the URL (or a deep
// link), so each one marks itself as started; authCallbackDecision then
// accepts the callback even if some other account is signed in on this
// device.
trySet("signUpWithEmail", async function (email: string, password: string) {
  markAuthFlowPending();
  return supabaseClient.auth.signUp({ email, password });
});

trySet("resetPasswordForEmail", async function (email: string) {
  markAuthFlowPending();
  return supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: RESET_CALLBACK,
  });
});

trySet("signInWithGoogle", async function () {
  markAuthFlowPending();
  return supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: AUTH_CALLBACK },
  });
});

trySet("signInWithApple", async function () {
  markAuthFlowPending();
  return supabaseClient.auth.signInWithOAuth({
    provider: "apple",
    options: { redirectTo: AUTH_CALLBACK },
  });
});

trySet("signOut", async function () {
  return supabaseClient.auth.signOut();
});

// Synchronous auth cache. storage.ts and applyAuthGate need to know
// "am I logged in?" without awaiting getSession() on every read/write.
// Prime on load, keep in sync via onAuthStateChange. Two events let UI
// re-render: cw:auth-changed (every auth event) and cw:auth-state-resolved
// (once, when the initial getSession() settles).
trySet("_cachedAuthUserId", null);
trySet("_authStateResolved", false);

// Optimistically prime _cachedAuthUserId from the already-persisted Supabase
// session so storage.ts transient reads route to localStorage on the very
// first synchronous call. Without this there is a sub-second window after
// every page load — before getSession() resolves below — where isLoggedInSync()
// returns false, so a logged-in user's reads mis-route to (empty) sessionStorage
// and fall back to defaults. Pages that snapshot state at DOMContentLoaded
// (recipe.html mineral inputs, the calculator results, source water) then keep
// showing defaults until something forces a re-read.
//
// Best-effort only: the async getSession() below stays the source of truth and
// overwrites this value (firing cw:auth-changed) if the token is invalid. Any
// drift — missing token, malformed JSON, storage blocked, or a future
// supabase-js key/shape change — leaves _cachedAuthUserId null and falls back
// to the prior behavior. Runs AFTER the null default above so it takes effect.
try {
  const primedUserId = extractUserIdFromPersistedSession(
    localStorage.getItem(persistedSessionStorageKey(SUPABASE_URL)),
  );
  if (primedUserId) trySet("_cachedAuthUserId", primedUserId);
} catch (_) {
  // localStorage unavailable (e.g. Safari private mode) — stay null.
}

supabaseClient.auth
  .getSession()
  .then(function (res) {
    const session = res?.data?.session;
    trySet("_cachedAuthUserId", session?.user?.id ?? null);
    trySet("_authStateResolved", true);
    try {
      document.dispatchEvent(new Event("cw:auth-state-resolved"));
    } catch (_) {}
  })
  .catch(function () {
    trySet("_authStateResolved", true);
    try {
      document.dispatchEvent(new Event("cw:auth-state-resolved"));
    } catch (_) {}
  });

supabaseClient.auth.onAuthStateChange(function (event, session) {
  trySet("_cachedAuthUserId", session?.user?.id ?? null);
  try {
    document.dispatchEvent(new CustomEvent("cw:auth-changed", { detail: { event } }));
  } catch (_) {}
});

trySet("isLoggedInSync", function () {
  return !!window._cachedAuthUserId;
});
