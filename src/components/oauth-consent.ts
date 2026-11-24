// OAuth consent page controller (oauth/consent.html).
//
// Supabase Auth's OAuth 2.1 server sends a user here when an AI app (through
// the MCP server, supabase/functions/mcp) asks to connect to their account:
//   /oauth/consent?authorization_id=<id>
// The page shows who is asking and what they will be able to do, then approves
// or denies the request. Opened with no authorization_id it lists the apps
// already connected, lets the user disconnect them, and lets the user allow
// abilities that were added after an app was connected.
//
// This is its own module entry and deliberately does NOT load
// legacy-globals.ts: the page needs the Supabase client and nothing else, and
// must not start cloud sync or the first-login merge from here. A signed-out
// visitor is sent to login.html, which runs the normal sign-in, and comes back
// (src/lib/post-login-redirect.ts).

import "../lib/polyfills";
import "../lib/sentry-init";
import { supabaseClient } from "../lib/supabase-client";
import {
  CONNECTED_APPS_PATH,
  consentReturnPath,
  rememberPostLoginRedirect,
} from "../lib/post-login-redirect";
import { abilitiesNotYetApproved, SHOWN_ABILITIES_VERSION } from "../lib/consent-abilities";

type View = "loading" | "request" | "apps" | "message";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function show(view: View): void {
  for (const name of ["loading", "request", "apps", "message"] as const) {
    el("consent-" + name).hidden = name !== view;
  }
}

function showMessage(title: string, body: string): void {
  el("consent-message-title").textContent = title;
  el("consent-message-body").textContent = body;
  show("message");
}

const EXPIRED_TITLE = "This request has expired";
const EXPIRED_BODY =
  "Go back to your AI app and connect to Cafelytic again. Connection requests only last a few minutes.";

/** Host of a redirect URI for display, or the raw value if it does not parse. */
export function redirectHost(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    if (url.protocol === "http:" || url.protocol === "https:") return url.host;
    // A custom scheme (a desktop or mobile app): show the scheme itself.
    return url.protocol + "//" + (url.host || "");
  } catch (_) {
    return redirectUri;
  }
}

function goTo(url: string): void {
  window.location.assign(url);
}

// The database keeps which version of this page's ability list the user
// approved for each app (mcp_app_consent), so an ability added later is not
// handed to an app the user approved before it existed. Both calls are best
// effort: an app with no record is treated as approved for the first version
// of the list only, which is the safe reading, so a failure here must never
// block connecting or disconnecting.
// The wait is bounded too: a request that never settles must not hold up the
// redirect back to the app or the refresh of the list.
const CONSENT_RECORD_TIMEOUT_MS = 4000;

async function bestEffort(call: PromiseLike<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(call),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CONSENT_RECORD_TIMEOUT_MS);
      }),
    ]);
  } catch (_) {
    // See above.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function recordApproval(clientId: string): Promise<void> {
  if (!clientId) return;
  // Refused when this page shows a different list from the database's current
  // one; the app then counts as approved for the first version only.
  await bestEffort(
    supabaseClient.rpc("mcp_record_app_consent", {
      p_client_id: clientId,
      p_shown_version: SHOWN_ABILITIES_VERSION,
    }),
  );
}

async function forgetApproval(clientId: string): Promise<void> {
  if (!clientId) return;
  await bestEffort(supabaseClient.rpc("mcp_forget_app_consent", { p_client_id: clientId }));
}

/**
 * The version each connected app was approved at, and the current version.
 * Null when either cannot be read: the list then shows no "Allow new
 * abilities" button, and nothing else on the page depends on it.
 */
async function loadApprovals(): Promise<{ current: number; byClient: Map<string, number> } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = Promise.all([
      supabaseClient.rpc("mcp_abilities_version"),
      supabaseClient.from("mcp_app_consent").select("client_id, abilities_version"),
    ]);
    const result = await Promise.race([
      read,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CONSENT_RECORD_TIMEOUT_MS);
      }),
    ]);
    if (!result) return null;
    const [version, rows] = result;
    if (version.error || rows.error || typeof version.data !== "number") return null;
    // This build can only describe, and so only ask about, its own list. When
    // the database's list differs (this page is older or newer than it), the
    // button is not offered; the database would refuse the approval anyway.
    if (version.data !== SHOWN_ABILITIES_VERSION) return null;
    const byClient = new Map<string, number>();
    for (const row of (rows.data || []) as { client_id: string; abilities_version: number }[]) {
      byClient.set(row.client_id, row.abilities_version);
    }
    return { current: version.data, byClient };
  } catch (_) {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function loadRequest(authorizationId: string): Promise<void> {
  const { data, error } = await supabaseClient.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    showMessage(EXPIRED_TITLE, EXPIRED_BODY);
    return;
  }
  // Already approved for this app: Supabase hands back the redirect directly.
  if ("redirect_url" in data && !("authorization_id" in data)) {
    goTo(data.redirect_url);
    return;
  }
  if (!("client" in data)) {
    showMessage(EXPIRED_TITLE, EXPIRED_BODY);
    return;
  }

  // Everything from the request is set with textContent: the app name is
  // chosen by whoever registered the client and must never be parsed as HTML.
  const appName = (data.client && data.client.name) || "An app";
  el("consent-app-name").textContent = appName;
  el("consent-account").textContent = (data.user && data.user.email) || "your account";
  el("consent-redirect-host").textContent = redirectHost(data.redirect_uri || "");
  show("request");

  const allowBtn = el<HTMLButtonElement>("consent-allow");
  const denyBtn = el<HTMLButtonElement>("consent-deny");
  const errorEl = el("consent-error");
  const clientId = (data.client && data.client.id) || "";

  async function decide(approve: boolean): Promise<void> {
    allowBtn.disabled = true;
    denyBtn.disabled = true;
    errorEl.textContent = "";
    try {
      const result = approve
        ? await supabaseClient.auth.oauth.approveAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          })
        : await supabaseClient.auth.oauth.denyAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          });
      if (result.error || !result.data || !result.data.redirect_url) {
        showMessage(EXPIRED_TITLE, EXPIRED_BODY);
        return;
      }
      if (approve) await recordApproval(clientId);
      goTo(result.data.redirect_url);
    } catch (_) {
      errorEl.textContent = "Something went wrong. Please try again.";
      allowBtn.disabled = false;
      denyBtn.disabled = false;
    }
  }

  allowBtn.addEventListener("click", () => void decide(true));
  denyBtn.addEventListener("click", () => void decide(false));
}

async function loadConnectedApps(): Promise<void> {
  const list = el("consent-apps-list");
  const empty = el("consent-apps-empty");
  const errorEl = el("consent-apps-error");
  const [{ data, error }, approvals] = await Promise.all([
    supabaseClient.auth.oauth.listGrants(),
    loadApprovals(),
  ]);
  show("apps");
  list.textContent = "";
  errorEl.textContent = "";
  if (error) {
    empty.hidden = true;
    errorEl.textContent = "Could not load your connected apps. Please try again.";
    return;
  }
  const grants = data || [];
  empty.hidden = grants.length > 0;
  for (const grant of grants) {
    const row = document.createElement("li");
    row.className = "consent-app-row";
    const info = document.createElement("div");
    const name = document.createElement("span");
    name.className = "consent-app-row-name";
    name.textContent = (grant.client && grant.client.name) || "Unnamed app";
    const since = document.createElement("span");
    since.className = "consent-app-row-since";
    const when = new Date(grant.granted_at);
    since.textContent = Number.isNaN(when.getTime())
      ? ""
      : "Connected " + when.toLocaleDateString();
    info.appendChild(name);
    info.appendChild(since);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "consent-disconnect-btn";
    btn.textContent = "Disconnect";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const res = await supabaseClient.auth.oauth.revokeGrant({ clientId: grant.client.id });
      if (res.error) {
        btn.disabled = false;
        errorEl.textContent = "Could not disconnect that app. Please try again.";
        return;
      }
      await forgetApproval(grant.client.id);
      void loadConnectedApps();
    });
    const actions = document.createElement("div");
    actions.className = "consent-app-row-actions";
    // An app with no record was approved before records were kept: version 1.
    const missing = approvals
      ? abilitiesNotYetApproved(approvals.byClient.get(grant.client.id) || 1, approvals.current)
      : [];
    if (missing.length > 0) {
      const note = document.createElement("span");
      note.className = "consent-app-row-new";
      note.textContent =
        "Added since you connected this app, and not allowed for it yet: " +
        missing.join("; ") +
        ".";
      info.appendChild(note);
      const allowBtn = document.createElement("button");
      allowBtn.type = "button";
      allowBtn.className = "consent-disconnect-btn consent-allow-new-btn";
      allowBtn.textContent = "Allow new abilities";
      allowBtn.addEventListener("click", async () => {
        allowBtn.disabled = true;
        errorEl.textContent = "";
        let failure: string | null;
        try {
          const res = await supabaseClient.rpc("mcp_record_app_consent", {
            p_client_id: grant.client.id,
            p_shown_version: SHOWN_ABILITIES_VERSION,
          });
          failure = !res.error
            ? null
            : res.error.code === "MCA02"
              ? "The list of abilities has changed. Reload this page and try again."
              : "Could not allow the new abilities. Please try again.";
        } catch (_) {
          failure = "Could not allow the new abilities. Please try again.";
        }
        if (failure) {
          allowBtn.disabled = false;
          errorEl.textContent = failure;
          return;
        }
        void loadConnectedApps();
      });
      actions.appendChild(allowBtn);
    }
    actions.appendChild(btn);
    row.appendChild(info);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

async function init(): Promise<void> {
  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");
  const returnPath = authorizationId ? consentReturnPath(authorizationId) : null;
  if (authorizationId && !returnPath) {
    showMessage(EXPIRED_TITLE, EXPIRED_BODY);
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    if (returnPath) {
      rememberPostLoginRedirect(returnPath);
      goTo("../login.html");
      return;
    }
    showMessage("Sign in to see your connected apps", "");
    const signIn = el("consent-signin-link");
    signIn.hidden = false;
    // Come back here after signing in. Recorded on the click, not on page
    // load, so merely visiting this page does not redirect a later sign-in.
    signIn.addEventListener("click", () => {
      rememberPostLoginRedirect(CONNECTED_APPS_PATH);
    });
    return;
  }

  if (authorizationId) await loadRequest(authorizationId);
  else await loadConnectedApps();
}

if (typeof document !== "undefined" && document.getElementById("consent-loading")) {
  void init().catch(() => {
    showMessage("Something went wrong", "Please go back to your AI app and try again.");
  });
}
