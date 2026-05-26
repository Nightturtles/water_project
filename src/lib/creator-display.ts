// Helper that decides what to render for a recipe's creator attribution.
//
// Three meanings collide in the data model:
//
//   1. System / Cafelytic catalog recipes  ->  user_id IS NULL
//      (these are the built-in profiles seeded by the app, no owner)
//
//   2. Original creator's account deleted  ->  user_id IS NOT NULL
//                                              AND creator_user_id IS NULL
//      (the recipe survives on the owner's profile, but the original
//      creator nulled out via delete_account() — see
//      supabase/migrations/<ts>_delete_account.sql)
//
//   3. Recipe has a known creator with no display name set
//      ->  creator_user_id IS NOT NULL, creatorDisplayName missing
//      (fallback to "Community", the pre-existing behavior)
//
// Centralizing this so the three call sites in recipe-browser.js and the
// one in library-picker.js can't drift. Exposed on window so the
// not-yet-converted classic-script UI files can call it without an import.

export interface CreatorAttributable {
  userId?: string | null;
  creatorUserId?: string | null;
  creatorDisplayName?: string | null;
}

export function creatorDisplayLabel(recipe: CreatorAttributable): string {
  if (!recipe || recipe.userId == null) return "Cafelytic";
  if (recipe.creatorUserId == null) return "Anonymous User";
  return recipe.creatorDisplayName || "Community";
}

// Bridge to window for the classic-script UI files. Mirrors the storage /
// sync / ui-shared pattern so this helper is reachable from any .js file
// loaded after legacy-globals.ts.
declare global {
  interface Window {
    creatorDisplayLabel?: (recipe: CreatorAttributable) => string;
  }
}

window.creatorDisplayLabel = creatorDisplayLabel;
