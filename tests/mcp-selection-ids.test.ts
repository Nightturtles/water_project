// public.mcp_set_enabled (the database function a connected AI app switches
// minerals and concentrates on through) only switches on ids the app knows.
// Those ids live in src/lib/constants.ts, so the function carries a copy. This
// test fails when the copy and the app differ: adding a mineral or a brand
// concentrate needs a new migration that re-creates the function.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_CONCENTRATES, MINERAL_DB } from "../src/lib/constants";

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

/** The ids in the newest migration that declares `<name> constant text[] := array[...]`. */
function idsInNewestMigration(name: string): string[] {
  const pattern = new RegExp(name + "\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]");
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  for (const file of files) {
    const match = pattern.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (match) return Array.from(match[1]!.matchAll(/'([^']+)'/g), (m) => m[1]!);
  }
  throw new Error(`no migration declares ${name}`);
}

describe("mcp_set_enabled id lists", () => {
  it("knows exactly the app's minerals", () => {
    expect(idsInNewestMigration("c_mineral_ids").sort()).toEqual(Object.keys(MINERAL_DB).sort());
  });

  it("knows exactly the app's brand concentrates", () => {
    expect(idsInNewestMigration("c_brand_ids").sort()).toEqual(
      Object.keys(BRAND_CONCENTRATES).sort(),
    );
  });
});
