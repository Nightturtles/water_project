// The MCP server (supabase/functions/mcp) shares the app's chemistry and
// naming rules through a generated bundle of src/lib/mcp-core.ts. These tests
// keep that bundle honest:
//   - it must be regenerated whenever its sources change (a stale bundle means
//     the server and the app disagree about GH / KH / range warnings);
//   - what it exports must work with every input passed explicitly, because on
//     the server there is no browser storage to fall back to.

import { test, expect, beforeEach } from "vitest";
import { isMcpCoreFresh } from "../scripts/build-mcp-core.mjs";
import * as core from "../src/lib/mcp-core";
import { saveSelectedMinerals } from "../src/lib/storage";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("app-core.gen.js is up to date (run `npm run mcp:build` if this fails)", async () => {
  expect(await isMcpCoreFresh()).toBe(true);
});

test("range findings do not depend on the browser's mineral selection", () => {
  // Sodium 35 mg/L sits between the two sodium bands for filter water: a
  // warning by default, acceptable when baking soda is the alkalinity source.
  // So this water tells the two cases apart.
  const ions = {
    calcium: 20,
    magnesium: 10,
    potassium: 0,
    sodium: 35,
    sulfate: 40,
    chloride: 35,
    bicarbonate: 49,
  };
  const explicit = {
    brewMethod: "filter",
    alkalinitySources: [] as string[],
    calciumSource: null,
    magnesiumSource: null,
  };
  const sodiumFinding = (result: { findings: { severity: string; message: string }[] }) =>
    JSON.stringify(result.findings.filter((f) => /sodium/i.test(f.message)));

  // saveSelectedMinerals (not a raw localStorage write) so storage.ts's cache
  // is invalidated and a function that reads the selection really sees it.
  saveSelectedMinerals(["calcium-chloride", "epsom-salt", "potassium-bicarbonate"]);
  const explicitBefore = core.evaluateWaterProfileRanges(ions, explicit);
  const implicitBefore = core.evaluateWaterProfileRanges(ions, { brewMethod: "filter" });

  saveSelectedMinerals(["calcium-chloride", "epsom-salt", "baking-soda"]);
  const explicitAfter = core.evaluateWaterProfileRanges(ions, explicit);
  const implicitAfter = core.evaluateWaterProfileRanges(ions, { brewMethod: "filter" });

  // Control: without explicit sources the selection DOES change the sodium
  // finding. If this stops holding, the assertion below proves nothing.
  expect(sodiumFinding(implicitAfter)).not.toBe(sodiumFinding(implicitBefore));
  // The way the server calls it: every source explicit, selection irrelevant.
  expect(explicitAfter).toEqual(explicitBefore);
});

test("validateProfileName never reuses a retired key", () => {
  const result = core.validateProfileName("Morning", {
    builtinKeys: new Set(["sca"]),
    existingKeys: new Set<string>(),
    existingLabels: new Set<string>(),
    retiredKeys: new Set(["morning"]),
  });
  expect(result).toMatchObject({ ok: true, key: "morning-2", name: "Morning" });
});
