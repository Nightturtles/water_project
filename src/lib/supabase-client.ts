// Supabase client + auth helpers — bundled via Vite (was loaded from CDN as a
// classic <script> before Phase A PR h). Imported by src/lib/legacy-globals.ts
// before storage.ts and sync.ts so window.supabaseClient is populated by the
// time those modules read it. Inline HTML scripts on login.html continue to
// call the window.signInWithEmail / window.signUpWithEmail / etc. helpers
// declared below — keep their signatures stable.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://srlwgayrxzamxlodpsrq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_X_Ui23hNRO1Uss-iLVSKiQ_cLqApXFq";

// Upgrade requests to keepalive: true when the page is being backgrounded or
// unloaded. Lets in-flight pushes (from flushPendingSync) survive navigation.
// 64 KB aggregate body cap, fine for this app's payloads.
export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

const w = window as unknown as Record<string, unknown>;

w.getUser = function () {
  return supabaseClient.auth.getUser();
};

w.isLoggedIn = function () {
  return supabaseClient.auth.getSession().then(({ data }) => !!data.session);
};

w.signInWithEmail = async function (email: string, password: string) {
  return supabaseClient.auth.signInWithPassword({ email, password });
};

w.signUpWithEmail = async function (email: string, password: string) {
  return supabaseClient.auth.signUp({ email, password });
};

w.resetPasswordForEmail = async function (email: string) {
  return supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: "https://cafelytic.com/reset-password.html",
  });
};

w.signInWithGoogle = async function () {
  return supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: "https://cafelytic.com/login.html" },
  });
};

w.signInWithApple = async function () {
  return supabaseClient.auth.signInWithOAuth({
    provider: "apple",
    options: { redirectTo: "https://cafelytic.com/login.html" },
  });
};

w.signOut = async function () {
  return supabaseClient.auth.signOut();
};

// Synchronous auth cache. storage.ts and applyAuthGate need to know
// "am I logged in?" without awaiting getSession() on every read/write.
// Prime on load, keep in sync via onAuthStateChange. Two events let UI
// re-render: cw:auth-changed (every auth event) and cw:auth-state-resolved
// (once, when the initial getSession() settles).
window._cachedAuthUserId = null;
window._authStateResolved = false;

supabaseClient.auth
  .getSession()
  .then(function (res) {
    const session = res?.data?.session;
    window._cachedAuthUserId = session?.user?.id ?? null;
    window._authStateResolved = true;
    try {
      document.dispatchEvent(new Event("cw:auth-state-resolved"));
    } catch (_) {}
  })
  .catch(function () {
    window._authStateResolved = true;
    try {
      document.dispatchEvent(new Event("cw:auth-state-resolved"));
    } catch (_) {}
  });

supabaseClient.auth.onAuthStateChange(function (event, session) {
  window._cachedAuthUserId = session?.user?.id ?? null;
  try {
    document.dispatchEvent(new CustomEvent("cw:auth-changed", { detail: { event } }));
  } catch (_) {}
});

window.isLoggedInSync = function () {
  return !!window._cachedAuthUserId;
};
