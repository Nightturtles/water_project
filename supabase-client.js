const SUPABASE_URL = 'https://srlwgayrxzamxlodpsrq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_X_Ui23hNRO1Uss-iLVSKiQ_cLqApXFq';

// Use a name that doesn't collide with the CDN global `window.supabase`.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Populate CW.auth namespace (stubs defined in constants.js)
CW.auth.client = supabaseClient;

CW.auth.getUser = function() {
  return supabaseClient.auth.getUser();
};

CW.auth.isLoggedIn = function() {
  return supabaseClient.auth.getSession().then(({ data }) => !!data.session);
};

CW.auth.signIn = async function(email, password) {
  return supabaseClient.auth.signInWithPassword({ email, password });
};

CW.auth.signUp = async function(email, password) {
  return supabaseClient.auth.signUp({ email, password });
};

CW.auth.signInWithGoogle = async function() {
  return supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
};

CW.auth.signInWithApple = async function() {
  return supabaseClient.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
};

CW.auth.signOut = async function() {
  return supabaseClient.auth.signOut();
};
