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
// No database writes: this is email-only, so there's no migration and no row to
// leak if the table policies were ever wrong.

// @ts-nocheck — Deno runtime; the project's tsconfig targets the browser JS
//               files and doesn't carry Deno's globals or the https:// imports.

const RESEND_URL = "https://api.resend.com/emails";
const SUPPORT_INBOX = "info@cafelytic.com";
// Verified Resend sender on the cafelytic.com domain. reply_to is set to the
// submitter below so hitting "Reply" in the inbox goes straight to them.
const FROM = "Cafelytic Support <info@cafelytic.com>";

const NAME_MAX = 100;
const EMAIL_MAX = 254; // RFC 5321 local+domain ceiling
const MESSAGE_MAX = 5000;
const SEND_TIMEOUT_MS = 15000;

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

Deno.serve(async (req: Request): Promise<Response> => {
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
});
