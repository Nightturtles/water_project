#!/usr/bin/env node
// Generate the "client secret" JWT that Supabase needs for Sign in with Apple.
//
// Apple's OAuth client secret is not a static string: it is an ES256-signed JWT
// that expires within 6 months. Regenerate it with this script when it lapses
// (sign-ins start failing with "invalid_client"):
//
//   APPLE_SERVICES_ID=com.cafelytic.signin \
//   APPLE_P8=~/Documents/cafelytic-secrets/AuthKey_XXXXXXXXXX.p8 \
//   node scripts/generate-apple-secret.mjs
//
// Team ID is read from ios/team.xcconfig (gitignored). Key ID is taken from the
// .p8 filename (AuthKey_<KEYID>.p8) unless APPLE_KEY_ID is set. The printed JWT
// (stdout) goes in Supabase -> Authentication -> Providers -> Apple ->
// "Secret Key (for OAuth)". Details print to stderr so `... | pbcopy` grabs
// only the token.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";
import { sign } from "node:crypto";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const fail = (m) => {
  console.error("ERROR: " + m);
  process.exit(1);
};

// Team ID from ios/team.xcconfig (or APPLE_TEAM_ID override).
let teamId = process.env.APPLE_TEAM_ID;
if (!teamId) {
  try {
    const xc = readFileSync(resolve(here, "..", "ios", "team.xcconfig"), "utf8");
    const m = xc.match(/^\s*DEVELOPMENT_TEAM\s*=\s*([A-Za-z0-9]+)/m);
    if (m) teamId = m[1];
  } catch {
    /* fall through to the error below */
  }
}
if (!teamId) fail("Team ID not found. Set APPLE_TEAM_ID or fill ios/team.xcconfig.");

const servicesId = process.env.APPLE_SERVICES_ID;
if (!servicesId) fail("Set APPLE_SERVICES_ID (your Services ID, e.g. com.cafelytic.signin).");

let p8Path = process.env.APPLE_P8;
if (!p8Path) fail("Set APPLE_P8 to the path of your Sign in with Apple .p8 key.");
p8Path = p8Path.replace(/^~(?=$|\/)/, homedir());

let keyId = process.env.APPLE_KEY_ID;
if (!keyId) {
  const m = basename(p8Path).match(/AuthKey_([A-Za-z0-9]+)\.p8$/);
  if (m) keyId = m[1];
}
if (!keyId) fail("Key ID not found. Set APPLE_KEY_ID or name the file AuthKey_<KEYID>.p8.");

let privateKey;
try {
  privateKey = readFileSync(p8Path, "utf8");
} catch {
  fail("Cannot read .p8 at " + p8Path);
}

const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 15777000; // Apple's hard max, in seconds
const exp = now + Math.min(180 * 86400, SIX_MONTHS);

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const header = { alg: "ES256", kid: keyId, typ: "JWT" };
const payload = { iss: teamId, iat: now, exp, aud: "https://appleid.apple.com", sub: servicesId };
const signingInput = b64url(header) + "." + b64url(payload);

let sig;
try {
  sig = sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" });
} catch (e) {
  fail("Signing failed (is the .p8 a valid Sign in with Apple key?): " + e.message);
}

console.error("--- Apple client secret ---");
console.error("Team ID (iss):     " + teamId);
console.error("Services ID (sub): " + servicesId);
console.error("Key ID (kid):      " + keyId);
console.error("Expires:           " + new Date(exp * 1000).toISOString());
console.error("---------------------------");
console.log(signingInput + "." + sig.toString("base64url"));
