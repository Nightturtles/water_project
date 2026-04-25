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
