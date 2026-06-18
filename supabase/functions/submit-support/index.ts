// Supabase Edge Function: submit-support
//
// Receives { name, email, message } from the public Support page (support.html)
// and emails it to info@cafelytic.com via the Resend API.
//
// Unauthenticated by design: the Support page must work for logged-out and
// locked-out users (someone who can't sign in still needs to reach us), so
// verify_jwt = false for this function in supabase/config.toml. That makes it a
// public endpoint, so it does its own input validation, length caps, and a
// honeypot field to blunt drive-by bot spam in lieu of auth. (estimate-water,
// by contrast, keeps verify_jwt = true because it gates a per-user quota.)
//
// Secrets required (set via `supabase secrets set ...`):
//   RESEND_API_KEY  - Resend API key with "Sending access" for the verified
//                     cafelytic.com domain (the same domain already used for
//                     Supabase Auth SMTP; see SUPABASE_SMTP.md).
//
// Database writes: a per-IP daily counter is stored in support_submission_quota
// via the increment_support_quota(text) RPC (service role only, SECURITY
// DEFINER). See migration 20260618051513_add_support_submission_quota.sql. The
// raw client IP is never stored; only its SHA-256 hash is written. The quota
// check fails open: if the RPC is unavailable or the env vars are missing, the
// email is still sent so support stays reachable.

const RESEND_URL = "https://api.resend.com/emails";
const SUPPORT_INBOX = "info@cafelytic.com";
// Verified Resend sender on the cafelytic.com domain. reply_to is set to the
// submitter below so hitting "Reply" in the inbox goes straight to them.
const FROM = "Cafelytic Support <info@cafelytic.com>";

const NAME_MAX = 100;
const EMAIL_MAX = 254; // RFC 5321 local+domain ceiling
const MESSAGE_MAX = 5000;
const SEND_TIMEOUT_MS = 15000;
const SUPPORT_DAILY_LIMIT = 10; // per IP per day; tunable (see migration note)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Permissive shape check. The real test is "can Resend deliver to it"; we only
// reject obviously-bad input. Mirrors the client-side regex in support.html.
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Escape user input before interpolating into the HTML email body.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // Parse + guard against null / array / primitive bodies — req.json() resolves
  // to whatever the body parses to, not necessarily a plain object.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request", message: "invalid json" }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json({ ok: false, error: "bad_request", message: "body must be an object" }, 400);
  }
  const obj = body as Record<string, unknown>;

  // Honeypot: a field no human sees or fills (it's off-screen in support.html).
  // Bots that blindly populate every input trip it. Return 200 "ok" so the bot
  // can't distinguish a drop from a real send.
  if (String(obj.company ?? "").trim().length > 0) {
    return json({ ok: true });
  }

  const name = String(obj.name ?? "").trim();
  const email = String(obj.email ?? "").trim();
  const message = String(obj.message ?? "").trim();

  if (name.length === 0 || name.length > NAME_MAX) {
    return json(
      { ok: false, error: "bad_request", message: `name must be 1-${NAME_MAX} chars` },
      400,
    );
  }
  if (!looksLikeEmail(email) || email.length > EMAIL_MAX) {
    return json({ ok: false, error: "bad_request", message: "a valid email is required" }, 400);
  }
  if (message.length === 0 || message.length > MESSAGE_MAX) {
    return json(
      { ok: false, error: "bad_request", message: `message must be 1-${MESSAGE_MAX} chars` },
      400,
    );
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  // Per-IP daily rate limit. submit-support is unauthenticated, so we bucket by
  // a hash of the client IP. Counting happens here (after validation) so only
  // would-be sends consume quota.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl && serviceKey) {
    try {
      const xff = req.headers.get("x-forwarded-for") ?? "";
      const ip = xff.split(",")[0].trim() || "unknown";
      const ipHash = await sha256Hex(ip);
      const quotaResp = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_support_quota`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_ip_hash: ipHash }),
      });
      if (quotaResp.ok) {
        const count = await quotaResp.json(); // scalar integer from the RPC
        if (typeof count === "number" && count > SUPPORT_DAILY_LIMIT) {
          return json(
            {
              ok: false,
              error: "rate_limited",
              message:
                "You've sent several messages today. Please try again tomorrow, or email info@cafelytic.com directly.",
            },
            429,
          );
        }
      } else {
        console.error("[submit-support] quota RPC non-OK:", quotaResp.status);
      }
    } catch (e) {
      console.error("[submit-support] quota check failed; failing open:", e);
    }
  }

  const subject = `Cafelytic support: message from ${name}`;
  const text =
    "New support message from the Cafelytic support page\n\n" +
    `Name: ${name}\n` +
    `Email: ${email}\n\n` +
    `Message:\n${message}\n`;
  const html =
    "<h2>New support message</h2>" +
    `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
    `<p><strong>Email:</strong> ${escapeHtml(email)}</p>` +
    "<p><strong>Message:</strong></p>" +
    `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;

  let resp: Response;
  try {
    resp = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [SUPPORT_INBOX],
        reply_to: email,
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return json({ ok: false, error: "timeout", message: "email send timed out" }, 504);
    }
    return json({ ok: false, error: "network", message: String(err.message ?? e) }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text();
    return json(
      { ok: false, error: "send_failed", status: resp.status, message: detail.slice(0, 500) },
      502,
    );
  }

  return json({ ok: true });
}

// Only start the server when this module is the program entry point.
if (import.meta.main) {
  Deno.serve(handler);
}
