// Where to send someone after they sign in, when it is not the calculator.
//
// One caller today: the OAuth consent page (oauth/consent.html). An AI app
// sends a signed-out user there; the page sends them to login.html to sign in
// and must get them back afterwards, including through a Google / Apple
// round trip (which lands on login.html again, in the same tab).
//
// The destination is kept in sessionStorage, not a URL parameter, so a crafted
// link cannot choose it, and it is checked against a fixed pattern both when
// stored and when read: the only place this can ever lead is the consent page
// with an authorization id.

const KEY = "cw_post_login_redirect";

// Relative to the site root. Authorization ids are opaque tokens from Supabase
// Auth; allow the URL-safe alphabet only.
const ALLOWED = /^oauth\/consent\?authorization_id=[A-Za-z0-9_-]{1,200}$/;

export function consentReturnPath(authorizationId: string): string | null {
  const path = "oauth/consent?authorization_id=" + authorizationId;
  return ALLOWED.test(path) ? path : null;
}

export function rememberPostLoginRedirect(path: string | null): boolean {
  if (!path || !ALLOWED.test(path)) return false;
  try {
    sessionStorage.setItem(KEY, path);
    return true;
  } catch (_) {
    return false;
  }
}

/** Read and clear the stored destination. Null when none, or not allowed. */
export function takePostLoginRedirect(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && ALLOWED.test(path) ? path : null;
  } catch (_) {
    return null;
  }
}

if (typeof window !== "undefined") {
  Object.assign(window, { takePostLoginRedirect });
}
