// Bundles src/lib/mcp-core.ts (the app logic the MCP server shares) into
// supabase/functions/mcp/app-core.gen.js.
//
// The MCP server is a Supabase Edge Function: it runs on Deno and is deployed
// from supabase/functions/ alone, so it cannot import from src/. Rather than
// keep a second copy of the chemistry and naming rules there, this script
// bundles the app's own modules into one generated file that IS committed.
//
//   npm run mcp:build     regenerate the file
//   npm run mcp:check     exit 1 if the committed file is stale (also run by
//                         tests/mcp-core.test.ts, so `npm test` and CI catch it)
//
// Regenerate whenever src/lib/mcp-core.ts or anything it imports changes.
//
// The file's header records two hashes, and the check verifies both:
//   source-hash  of the SOURCE modules that went into the bundle. Staleness is
//                judged by this, not by comparing bundler output, so a bundler
//                upgrade that only reformats the output does not fail it.
//   body-hash    of the generated code below the header. Catches the file
//                being edited by hand, or a merge that changes the code while
//                leaving the source-hash line alone.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rolldown } from "rolldown";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "src/lib/mcp-core.ts");
export const outFile = path.join(root, "supabase/functions/mcp/app-core.gen.js");

const SOURCE_HASH_LINE = /^\/\/ source-hash: ([0-9a-f]{64})$/m;
const BODY_HASH_LINE = /^\/\/ body-hash: ([0-9a-f]{64})$/m;
const BANNER_END = "// deno-fmt-ignore-file\n";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function banner(sourceHash, bodyHash) {
  return `// GENERATED FILE - do not edit. Source: src/lib/mcp-core.ts
// Regenerate with: npm run mcp:build
// source-hash: ${sourceHash}
// body-hash: ${bodyHash}
// deno-lint-ignore-file
${BANNER_END}`;
}

/** Bundle the entry. Returns the file text and the hash of its source modules. */
export async function buildMcpCore() {
  const bundle = await rolldown({ input: entry, logLevel: "warn" });
  try {
    const { output } = await bundle.generate({ format: "esm" });
    if (output.length !== 1) {
      throw new Error(`expected one output chunk, got ${output.length}`);
    }
    const chunk = output[0];
    const hash = createHash("sha256");
    for (const id of [...chunk.moduleIds].sort()) {
      hash.update(path.relative(root, id) + "\0");
      hash.update(readFileSync(id));
      hash.update("\0");
    }
    const digest = hash.digest("hex");
    return { code: banner(digest, sha256(chunk.code)) + chunk.code, hash: digest };
  } finally {
    await bundle.close();
  }
}

export async function isMcpCoreFresh() {
  let committed;
  try {
    committed = readFileSync(outFile, "utf8");
  } catch {
    return false;
  }
  // 1. The committed code is the code its own header describes.
  const end = committed.indexOf(BANNER_END);
  if (end === -1) return false;
  const header = committed.slice(0, end + BANNER_END.length);
  const body = committed.slice(end + BANNER_END.length);
  const bodyHash = BODY_HASH_LINE.exec(header);
  if (!bodyHash || bodyHash[1] !== sha256(body)) return false;
  // 2. It was generated from the sources as they are now.
  const sourceHash = SOURCE_HASH_LINE.exec(header);
  return !!sourceHash && sourceHash[1] === (await buildMcpCore()).hash;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    if (!(await isMcpCoreFresh())) {
      console.error(
        "supabase/functions/mcp/app-core.gen.js is stale. Run `npm run mcp:build` and commit the result.",
      );
      process.exit(1);
    }
    console.log("app-core.gen.js is up to date.");
  } else {
    writeFileSync(outFile, (await buildMcpCore()).code);
    console.log("Wrote " + path.relative(root, outFile));
  }
}
