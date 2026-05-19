const SUPABASE_URL = 'https://srlwgayrxzamxlodpsrq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_X_Ui23hNRO1Uss-iLVSKiQ_cLqApXFq';

// Use a name that doesn't collide with the CDN global `window.supabase`.
// All public functions are assigned to window explicitly.
// Upgrade requests to `keepalive: true` when the page is being backgrounded or
// unloaded.  This lets in-flight pushes (from flushPendingSync) survive
// navigation.  64 KB aggregate body cap — fine for this app's payloads.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: function (url, opts) {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        opts = Object.assign({}, opts, { keepalive: true });
      }
      return fetch(url, opts);
    }
  }
});
window.supabaseClient = supabaseClient;
console.log('supabase-client.js loaded, supabaseClient:', typeof window.supabaseClient);

window.getUser = function() {
  return supabaseClient.auth.getUser();
};

window.isLoggedIn = function() {
  return supabaseClient.auth.getSession().then(({ data }) => !!data.session);
};

window.signInWithEmail = async function(email, password) {
  return supabaseClient.auth.signInWithPassword({ email, password });
};

window.signUpWithEmail = async function(email, password) {
  return supabaseClient.auth.signUp({ email, password });
};

window.resetPasswordForEmail = async function(email) {
  return supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://cafelytic.com/reset-password.html'
  });
};

window.signInWithGoogle = async function() {
  return supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
};

window.signInWithApple = async function() {
  return supabaseClient.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
};

window.signOut = async function() {
  return supabaseClient.auth.signOut();
};

// --- Synchronous auth cache ---
// storage.js and applyAuthGate need to know "am I logged in?" without
// awaiting getSession() on every read/write.  We prime the cache on load and
// keep it in sync via onAuthStateChange; consumers read window._cachedAuthUserId
// or call window.isLoggedInSync().  Two events let UI re-render: cw:auth-changed
// (fires on every auth event) and cw:auth-state-resolved (fires once when the
// initial getSession() settles).
window._cachedAuthUserId = null;
window._authStateResolved = false;

supabaseClient.auth.getSession().then(function (res) {
  var session = res && res.data && res.data.session;
  window._cachedAuthUserId = session && session.user ? session.user.id : null;
  window._authStateResolved = true;
  try {
    document.dispatchEvent(new Event("cw:auth-state-resolved"));
  } catch (_) {}
}).catch(function () {
  window._authStateResolved = true;
  try {
    document.dispatchEvent(new Event("cw:auth-state-resolved"));
  } catch (_) {}
});

supabaseClient.auth.onAuthStateChange(function (event, session) {
  window._cachedAuthUserId = session && session.user ? session.user.id : null;
  try {
    document.dispatchEvent(new CustomEvent("cw:auth-changed", { detail: { event: event } }));
  } catch (_) {}
});

window.isLoggedInSync = function () {
  return !!window._cachedAuthUserId;
};
