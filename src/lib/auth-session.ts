// Pure, side-effect-free helpers for reading the persisted Supabase auth
// session synchronously. Deliberately free of `window`, the Supabase client,
// and any module-load side-effects so they are unit-testable in isolation and
// so supabase-client.ts can prime the "am I logged in?" flag BEFORE the async
// getSession() resolves (see the prime call there for the full rationale).

// supabase-js v2 stores the session in localStorage under a key derived from
// the project URL host: `sb-${new URL(url).hostname.split(".")[0]}-auth-token`
// (verified against @supabase/supabase-js 2.103.3). Mirror that derivation here
// so the key stays correct if SUPABASE_URL ever changes.
export function persistedSessionStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

// Pull the user id out of the raw persisted-session JSON string. Returns null
// for a missing, malformed, or user-less value. Handles the bare v2 session
// shape ({ user: { id } }) and, defensively, a v1-style { currentSession }
// wrapper. Never throws — any parse failure degrades to null (treated as
// "not logged in", which falls back to the prior pre-auth behavior).
// Read the `sub` (user id) claim from a JWT without verifying it. Only used to
// compare an incoming callback token against the signed-in user; the token is
// still validated server-side by auth-js before any session is adopted.
export function jwtSubject(token: string | null | undefined): string | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const sub = JSON.parse(atob(padded)).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch (_) {
    return null;
  }
}

// How long after this app starts a sign-in / sign-up / password-reset flow a
// callback for a *different* account is still accepted. Covers the email
// links (Supabase's link expiry is at most a day) with margin.
export const AUTH_FLOW_PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

// Decide whether an auth callback (tokens in the URL hash, or a native deep
// link) may replace the current session. Accept it when nobody is signed in
// (an ordinary sign-in / confirmation landing), when it's for the account
// already signed in (e.g. a password-reset link), or when this app itself
// started an auth flow recently. Otherwise it's an unsolicited link for some
// other account: adopting it would silently move the signed-in user into that
// account and their local data along with it.
export function shouldAdoptCallbackSession(input: {
  incomingAccessToken: string | null;
  existingUserId: string | null;
  pendingFlowStartedAt: number | null;
  now: number;
}): boolean {
  if (!input.incomingAccessToken) return true; // error-only callback: nothing to adopt
  if (!input.existingUserId) return true;
  if (jwtSubject(input.incomingAccessToken) === input.existingUserId) return true;
  const started = input.pendingFlowStartedAt;
  if (started == null || !Number.isFinite(started)) return false;
  const age = input.now - started;
  return age >= 0 && age <= AUTH_FLOW_PENDING_WINDOW_MS;
}

export function extractUserIdFromPersistedSession(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const session = parsed && parsed.currentSession ? parsed.currentSession : parsed;
    const id = session?.user?.id;
    return typeof id === "string" && id ? id : null;
  } catch (_) {
    return null;
  }
}
