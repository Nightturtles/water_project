// The Connected apps list offers "Allow new abilities" for an app the user
// approved before the consent page's list grew (src/lib/consent-abilities.ts, used by src/components/oauth-consent.ts).

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { abilitiesNotYetApproved, SHOWN_ABILITIES_VERSION } from "../src/lib/consent-abilities";

describe("abilitiesNotYetApproved", () => {
  it("is empty for an app approved at the current version", () => {
    expect(abilitiesNotYetApproved(2, 2)).toEqual([]);
    expect(abilitiesNotYetApproved(1, 1)).toEqual([]);
  });

  it("lists what version 2 added for an app approved at version 1", () => {
    const missing = abilitiesNotYetApproved(1, 2);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.join(" ")).toMatch(/minerals and concentrates/);
    expect(missing.join(" ")).toMatch(/active recipe and source water/);
  });

  it("treats a missing or odd record as version 1", () => {
    expect(abilitiesNotYetApproved(0, 2)).toEqual(abilitiesNotYetApproved(1, 2));
    expect(abilitiesNotYetApproved(-3, 2)).toEqual(abilitiesNotYetApproved(1, 2));
  });

  it("is empty for an app approved at a later version than the page knows", () => {
    expect(abilitiesNotYetApproved(3, 2)).toEqual([]);
  });
});

describe("SHOWN_ABILITIES_VERSION", () => {
  it("matches the newest mcp_abilities_version() in the migrations", () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const pattern = /function public\.mcp_abilities_version\(\)[\s\S]*?select (\d+);/;
    const versions = readdirSync(dir)
      .sort()
      .map((file) => pattern.exec(readFileSync(join(dir, file), "utf8")))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]));
    expect(versions.length).toBeGreaterThan(0);
    expect(SHOWN_ABILITIES_VERSION).toBe(versions[versions.length - 1]);
  });
});
