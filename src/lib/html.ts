// Shared HTML-escaping utility — the single source for turning user-authored
// text (recipe/profile labels, derive notes, mineral names) into HTML-safe
// strings before it goes into innerHTML.
//
// Prefer textContent / createTextNode where you can; reach for this only when
// building an HTML string is genuinely unavoidable.
//
// Self-publishes window.escapeHtml so the not-yet-migrated classic scripts
// (diy-editor.js, stock-editor.js) and inline page scripts (minerals.html) share
// one implementation instead of each redefining their own copy. legacy-globals.ts
// imports this early, so the global exists before any editor or render runs.
export function escapeHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

if (typeof window !== "undefined") {
  window.escapeHtml = escapeHtml;
}
