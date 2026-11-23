// The Connected apps list offers "Allow new abilities" for an app the user
// approved before the consent page's list grew (src/lib/consent-abilities.ts, used by src/components/oauth-consent.ts).

import { describe, expect, it } from "vitest";
import { abilitiesNotYetApproved } from "../src/lib/consent-abilities";

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
