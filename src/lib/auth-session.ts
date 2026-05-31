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
