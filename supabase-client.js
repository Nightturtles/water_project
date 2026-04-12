const SUPABASE_URL = 'https://srlwgayrxzamxlodpsrq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_X_Ui23hNRO1Uss-iLVSKiQ_cLqApXFq';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getUser() {
  return supabase.auth.getUser();
}

function isLoggedIn() {
  return supabase.auth.getSession().then(({ data }) => !!data.session);
}

async function signInWithEmail(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

async function signUpWithEmail(email, password) {
  return supabase.auth.signUp({ email, password });
}

async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
}

async function signInWithApple() {
  return supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: 'https://cafelytic.com/login.html' }
  });
}

async function signOut() {
  return supabase.auth.signOut();
}
