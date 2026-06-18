// Unit tests for the submit-support edge function handler.
// Run with: deno test --allow-env (inside supabase/functions/)
import { strict as assert } from "node:assert";
import { handler } from "./index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postReq(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/submit-support", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const VALID_BODY = {
  name: "Alice",
  email: "alice@example.com",
  message: "Hello, I need help.",
};

// ---------------------------------------------------------------------------
// 1. OPTIONS → 200, "ok", CORS header, fetch not called
// ---------------------------------------------------------------------------
Deno.test("OPTIONS returns 200 with CORS", async () => {
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  };
  try {
    const req = new Request("http://localhost/submit-support", { method: "OPTIONS" });
    const res = await handler(req);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body, "ok");
    assert.ok(res.headers.get("Access-Control-Allow-Origin"), "CORS header missing");
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 2. GET → 405, fetch not called
// ---------------------------------------------------------------------------
Deno.test("GET returns 405 method_not_allowed", async () => {
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  };
  try {
    const req = new Request("http://localhost/submit-support", { method: "GET" });
    const res = await handler(req);
    assert.equal(res.status, 405);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "method_not_allowed");
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 3. Body not valid JSON → 400 "invalid json"
// ---------------------------------------------------------------------------
Deno.test("invalid JSON body returns 400", async () => {
  const req = new Request("http://localhost/submit-support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json{{{",
  });
  const res = await handler(req);
  assert.equal(res.status, 400);
  const data = await res.json() as { message: string };
  assert.ok(data.message.includes("invalid json"));
});

// ---------------------------------------------------------------------------
// 4. Body is a JSON array → 400 "body must be an object"
// ---------------------------------------------------------------------------
Deno.test("JSON array body returns 400", async () => {
  const res = await handler(postReq([1, 2, 3]));
  assert.equal(res.status, 400);
  const data = await res.json() as { message: string };
  assert.ok(data.message.includes("body must be an object"));
});

// ---------------------------------------------------------------------------
// 5. Honeypot tripped → 200 {ok:true}, fetch NOT called
// ---------------------------------------------------------------------------
Deno.test("honeypot tripped returns 200 without sending", async () => {
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  };
  try {
    const res = await handler(postReq({ ...VALID_BODY, company: "spambot" }));
    assert.equal(res.status, 200);
    const data = await res.json() as { ok: boolean };
    assert.equal(data.ok, true);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 6a. Missing/blank name → 400
// ---------------------------------------------------------------------------
Deno.test("blank name returns 400", async () => {
  const res = await handler(postReq({ ...VALID_BODY, name: "" }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// 6b. name > 100 chars → 400
// ---------------------------------------------------------------------------
Deno.test("name over 100 chars returns 400", async () => {
  const res = await handler(postReq({ ...VALID_BODY, name: "a".repeat(101) }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// 7a. Invalid email → 400
// ---------------------------------------------------------------------------
Deno.test("invalid email returns 400", async () => {
  const res = await handler(postReq({ ...VALID_BODY, email: "nope" }));
  assert.equal(res.status, 400);
  const data = await res.json() as { message: string };
  assert.ok(data.message.includes("email"));
});

// ---------------------------------------------------------------------------
// 7b. email > 254 chars → 400
// ---------------------------------------------------------------------------
Deno.test("email over 254 chars returns 400", async () => {
  const longEmail = "a".repeat(243) + "@example.com"; // 255 chars total
  const res = await handler(postReq({ ...VALID_BODY, email: longEmail }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// 8a. Blank message → 400
// ---------------------------------------------------------------------------
Deno.test("blank message returns 400", async () => {
  const res = await handler(postReq({ ...VALID_BODY, message: "" }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// 8b. message > 5000 chars → 400
// ---------------------------------------------------------------------------
Deno.test("message over 5000 chars returns 400", async () => {
  const res = await handler(postReq({ ...VALID_BODY, message: "x".repeat(5001) }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// 9. RESEND_API_KEY unset → 500 server_misconfigured, fetch not called
// ---------------------------------------------------------------------------
Deno.test("missing RESEND_API_KEY returns 500", async () => {
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  };
  const savedKey = Deno.env.get("RESEND_API_KEY");
  Deno.env.delete("RESEND_API_KEY");
  try {
    const res = await handler(postReq(VALID_BODY));
    assert.equal(res.status, 500);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "server_misconfigured");
    assert.equal(fetchCalled, false);
  } finally {
    if (savedKey !== undefined) Deno.env.set("RESEND_API_KEY", savedKey);
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 10. Happy path — fetch called once, correct payload, returns 200 {ok:true}
// ---------------------------------------------------------------------------
Deno.test("happy path sends to Resend and returns 200", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  let capturedRequest: Request | null = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, _init?: RequestInit) => {
    capturedRequest = new Request(input instanceof Request ? input : String(input), _init);
    return new Response(null, { status: 200 });
  };
  try {
    const res = await handler(postReq(VALID_BODY));
    assert.equal(res.status, 200);
    const data = await res.json() as { ok: boolean };
    assert.equal(data.ok, true);

    assert.ok(capturedRequest !== null, "fetch was not called");
    const req = capturedRequest as Request;
    assert.equal(req.url, "https://api.resend.com/emails");
    assert.equal(req.headers.get("Authorization"), "Bearer test-key");

    const sentBody = await req.json() as {
      reply_to: string;
      to: string[];
      subject: string;
    };
    assert.equal(sentBody.reply_to, VALID_BODY.email);
    assert.deepEqual(sentBody.to, ["info@cafelytic.com"]);
    assert.ok(sentBody.subject.includes(VALID_BODY.name));
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 11. HTML escaping in the html field; text field is plaintext (not escaped)
// ---------------------------------------------------------------------------
Deno.test("HTML escaping: <script> in name is escaped in html field", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const xssName = "<script>alert(1)</script>";
  let capturedRequest: Request | null = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, _init?: RequestInit) => {
    capturedRequest = new Request(input instanceof Request ? input : String(input), _init);
    return new Response(null, { status: 200 });
  };
  try {
    const res = await handler(postReq({ ...VALID_BODY, name: xssName }));
    assert.equal(res.status, 200);

    assert.ok(capturedRequest !== null);
    const req = capturedRequest as Request;
    const sentBody = await req.json() as { html: string };
    assert.ok(sentBody.html.includes("&lt;script&gt;"), "html field should escape <script>");
    assert.ok(!sentBody.html.includes("<script>"), "html field must not contain raw <script>");
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 12. Resend returns non-OK → 502 send_failed
// ---------------------------------------------------------------------------
Deno.test("Resend non-OK response returns 502", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("boom", { status: 500 });
  try {
    const res = await handler(postReq(VALID_BODY));
    assert.equal(res.status, 502);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "send_failed");
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 13a. Resend fetch throws TimeoutError → 504
// ---------------------------------------------------------------------------
Deno.test("Resend TimeoutError returns 504", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new DOMException("timed out", "TimeoutError");
  };
  try {
    const res = await handler(postReq(VALID_BODY));
    assert.equal(res.status, 504);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "timeout");
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 13b. Generic Error from fetch → 502 network
// ---------------------------------------------------------------------------
Deno.test("Resend generic network error returns 502", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  try {
    const res = await handler(postReq(VALID_BODY));
    assert.equal(res.status, 502);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "network");
  } finally {
    globalThis.fetch = origFetch;
  }
});
