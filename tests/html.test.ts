// Unit tests for escapeHtml (src/lib/html.ts): the single XSS guard that
// user-authored text (recipe/profile labels, derive notes, mineral names)
// passes through before it is concatenated into innerHTML strings.
import { describe, test, expect } from "vitest";
import { escapeHtml } from "../src/lib/html";

describe("escapeHtml", () => {
  test("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  test("neutralizes a script-injection label", () => {
    const out = escapeHtml("<img src=x onerror=alert(1)>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("cannot break out of a double- or single-quoted attribute", () => {
    expect(escapeHtml(`" onmouseover="alert(1)`)).toBe("&quot; onmouseover=&quot;alert(1)");
    expect(escapeHtml(`' onmouseover='alert(1)`)).toBe("&#39; onmouseover=&#39;alert(1)");
  });

  test("escapes & first, so existing entities are not double-decoded", () => {
    // "&lt;" typed by a user must render literally as "&lt;", not as "<".
    expect(escapeHtml("&lt;b&gt;")).toBe("&amp;lt;b&amp;gt;");
  });

  test("leaves plain text, unicode, and empty strings unchanged", () => {
    expect(escapeHtml("Light Roast 92°C")).toBe("Light Roast 92°C");
    expect(escapeHtml("Café ☕ – Ca²⁺")).toBe("Café ☕ – Ca²⁺");
    expect(escapeHtml("")).toBe("");
  });

  test("stringifies non-string input instead of throwing", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(null)).toBe("null");
    expect(escapeHtml(undefined)).toBe("undefined");
  });

  test("publishes itself on window for the inline page scripts", () => {
    expect((globalThis as any).window?.escapeHtml).toBe(escapeHtml);
  });
});
