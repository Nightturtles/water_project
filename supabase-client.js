const SUPABASE_URL = 'https://srlwgayrxzamxlodpsrq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_X_Ui23hNRO1Uss-iLVSKiQ_cLqApXFq';

// NOTE: Because this script declares `const supabase` which shadows the CDN's
// window.supabase, V8 will not hoist function declarations from this script to
// window. All public functions must be assigned to window explicitly.
// The client itself is also exposed as window.supabaseClient for sync.js and
// any inline script that needs raw Supabase access.
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabase;

window.getUser = function() {
  return supabase.auth.getUser();
};

window.isLoggedIn = function() {
  return supabase.auth.getSession().then(({ data }) => !!data.session);
};

window.signInWithEmail = async function(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
};

window.signUpWithEmail = async function(email, password) {
  return supabase.auth.signUp({ email, password });
};

window.signInWithGoogle = async function() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
};

window.signInWithApple = async function() {
  return supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
};

window.signOut = async function() {
  return supabase.auth.signOut();
};
