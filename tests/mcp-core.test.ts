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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("app-core.gen.js is up to date (run `npm run mcp:build` if this fails)", async () => {
  expect(await isMcpCoreFresh()).toBe(true);
});

test("range findings do not depend on the browser's mineral selection", () => {
  const ions = {
    calcium: 20,
    magnesium: 10,
    potassium: 0,
    sodium: 120,
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
  const before = core.evaluateWaterProfileRanges(ions, explicit);
  // Change what the "browser" has selected; with every source passed
  // explicitly the result must not move.
  localStorage.setItem("cw_selected_minerals", JSON.stringify(["baking-soda", "gypsum"]));
  const after = core.evaluateWaterProfileRanges(ions, explicit);
  expect(after).toEqual(before);
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
