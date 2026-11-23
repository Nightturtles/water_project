// Which abilities a connected AI app has not been approved for yet. Pure, so
// it can be tested without the consent page (src/components/oauth-consent.ts).

// The version of the ability list this build of the consent page shows
// (oauth/consent.html). Sent with every approval so the database can refuse
// one given from a page that showed a different list.
export const SHOWN_ABILITIES_VERSION = 2;

// What each version of the ability list added, in the words the consent page
// uses (oauth/consent.html). Version 1 is the original list. Add an entry in
// the same change that raises public.mcp_abilities_version().
const ABILITIES_ADDED: Record<number, string[]> = {
  2: [
    "switch your minerals and concentrates on or off",
    "choose your active recipe and source water",
  ],
};

/**
 * The abilities an app approved at `approved` has not been approved for, when
 * the list is now at `current`. Empty when it is up to date.
 */
export function abilitiesNotYetApproved(approved: number, current: number): string[] {
  const out: string[] = [];
  for (let v = Math.max(1, approved) + 1; v <= current; v++) {
    out.push(...(ABILITIES_ADDED[v] || []));
  }
  return out;
}
