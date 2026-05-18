// Supabase Edge Function: estimate-water
//
// Takes { zip, provider } from the browser, validates JWT + email allowlist,
// then calls the Anthropic Messages API with web_search + a forced
// report_water_profile tool. Returns the 7-ion profile (mg/L) to the client.
//
// Secrets required (set via `supabase secrets set ...`):
//   ANTHROPIC_API_KEY            - Anthropic API key
//   ESTIMATE_WATER_ALLOWLIST     - comma-separated emails allowed to call this
//
// SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected by the platform.

// @ts-nocheck — Deno runtime; the project's tsconfig targets the browser JS
//               files and tries to resolve these `https://` imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT =
  "You estimate US tap water mineral profiles (calcium, magnesium, " +
  "potassium, sodium, sulfate, chloride, bicarbonate; all mg/L). Use " +
  "web_search to find the most recent Consumer Confidence Report (CCR) " +
  "for the given utility when helpful. When done, call " +
  "report_water_profile exactly once with your estimate. If a value is " +
  "unknown, infer from regional averages and set confidence accordingly.";

const TOOLS = [
  { type: "web_search_20250305", name: "web_search", max_uses: 3 },
  {
    name: "report_water_profile",
    description: "Report the estimated tap water profile in mg/L.",
    input_schema: {
      type: "object",
      required: [
        "calcium",
        "magnesium",
        "potassium",
        "sodium",
        "sulfate",
        "chloride",
        "bicarbonate",
        "confidence",
        "source",
      ],
      properties: {
        calcium:     { type: "number", minimum: 0, maximum: 600 },
        magnesium:   { type: "number", minimum: 0, maximum: 200 },
        potassium:   { type: "number", minimum: 0, maximum: 100 },
        sodium:      { type: "number", minimum: 0, maximum: 500 },
        sulfate:     { type: "number", minimum: 0, maximum: 1000 },
        chloride:    { type: "number", minimum: 0, maximum: 500 },
        bicarbonate: { type: "number", minimum: 0, maximum: 2000 },
        confidence:  { type: "string", enum: ["low", "medium", "high"] },
        source:      { type: "string", maxLength: 200 },
      },
      additionalProperties: false,
    },
  },
];

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // 1. JWT validation. The Supabase JS client auto-injects the user's
  //    Bearer token when called via supabaseClient.functions.invoke, so we
  //    re-create a user-scoped client here to resolve user.email.
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const email = userData?.user?.email;
  if (userErr || !email) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // 2. Server-side allowlist — security boundary. Client-side gate in
  //    estimate-water-ui.js is a UX hint only.
  const allow = (Deno.env.get("ESTIMATE_WATER_ALLOWLIST") ?? "")
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allow.includes(email.toLowerCase())) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // 3. Parse + validate input. Guard against null / array / primitive
  //    bodies from clients that misuse the endpoint — req.json() resolves
  //    to whatever the body parses to, not necessarily a plain object.
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

  // Preflight ping: client uses this on page load to decide whether to
  // render the UI without leaking the allowlist client-side. Reaches this
  // point only after JWT + allowlist pass, so a 200 here means "you may
  // call the estimator". Cheap — no Claude call.
  if (obj.check === true) {
    return json({ ok: true, allowed: true });
  }

  const zip = String(obj.zip ?? "").trim();
  const provider = String(obj.provider ?? "").trim();
  if (!/^\d{5}$/.test(zip)) {
    return json({ ok: false, error: "bad_request", message: "zip must be 5 digits" }, 400);
  }
  if (provider.length === 0 || provider.length > 120) {
    return json({ ok: false, error: "bad_request", message: "provider must be 1-120 chars" }, 400);
  }

  // 4. Call Anthropic. Raw fetch (no SDK) keeps the cold-start small in Deno.
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  // 25s deadline. Anthropic responses with web_search typically finish in
  // 5-15s; this keeps a single stuck request from holding the function
  // worker open until the platform's hard timeout.
  const ANTHROPIC_TIMEOUT_MS = 25000;

  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: TOOLS,
        // tool_choice "auto" — cannot force report_water_profile while
        // web_search is also offered. The system prompt instructs the model
        // to call report_water_profile last; the parse_error branch handles
        // the rare miss.
        messages: [
          {
            role: "user",
            content: JSON.stringify({ zip, provider }),
          },
        ],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return json({ ok: false, error: "timeout", message: "anthropic request timed out" }, 504);
    }
    return json(
      { ok: false, error: "network", message: String(err.message ?? e) },
      502,
    );
  }

  if (!resp.ok) {
    const text = await resp.text();
    const code = resp.status === 429 ? "rate_limit" : "model_error";
    return json(
      { ok: false, error: code, status: resp.status, message: text.slice(0, 500) },
      502,
    );
  }

  const data = await resp.json();
  const tool = Array.isArray(data?.content)
    ? data.content.find(
        (b: { type?: string; name?: string }) =>
          b && b.type === "tool_use" && b.name === "report_water_profile",
      )
    : null;
  if (!tool || !tool.input) {
    return json({ ok: false, error: "parse_error" }, 502);
  }

  const { confidence, source, ...profile } = tool.input;
  return json({
    ok: true,
    profile,
    confidence,
    source,
    model: MODEL,
    usage: data.usage,
  });
});
