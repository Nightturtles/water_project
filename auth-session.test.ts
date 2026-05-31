// Unit tests for the pure persisted-session helpers that let supabase-client.ts
// prime the logged-in flag synchronously (before the initial getSession()
// resolves). The parsing + key-derivation logic lives in a side-effect-free
// module precisely so it can be tested without importing the Supabase client
// (which has heavy module-load side-effects: createClient, getSession, etc.).
// The module-load wiring (read localStorage -> trySet) is covered by the
// Playwright round-trip in e2e/.
import { describe, test, expect } from "vitest";
import {
  persistedSessionStorageKey,
  extractUserIdFromPersistedSession,
} from "./src/lib/auth-session";

describe("persistedSessionStorageKey", () => {
  test("derives the sb-<ref>-auth-token key from the project URL", () => {
    expect(persistedSessionStorageKey("https://srlwgayrxzamxlodpsrq.supabase.co")).toBe(
      "sb-srlwgayrxzamxlodpsrq-auth-token",
    );
  });

  test("uses the first hostname label as the ref", () => {
    expect(persistedSessionStorageKey("https://abcde.supabase.co")).toBe("sb-abcde-auth-token");
  });
});

describe("extractUserIdFromPersistedSession", () => {
  test("extracts user.id from a bare v2 session", () => {
    const raw = JSON.stringify({
      access_token: "a",
      refresh_token: "r",
      expires_at: 123,
      user: { id: "u123" },
    });
    expect(extractUserIdFromPersistedSession(raw)).toBe("u123");
  });

  test("extracts user.id from a defensive { currentSession } wrapper", () => {
    const raw = JSON.stringify({ currentSession: { user: { id: "u456" } }, expiresAt: 1 });
    expect(extractUserIdFromPersistedSession(raw)).toBe("u456");
  });

  test("returns null for null or empty input", () => {
    expect(extractUserIdFromPersistedSession(null)).toBeNull();
    expect(extractUserIdFromPersistedSession("")).toBeNull();
  });

  test("returns null for malformed JSON without throwing", () => {
    expect(extractUserIdFromPersistedSession("{not json")).toBeNull();
  });

  test("returns null when there is no user, no id, or a non-string id", () => {
    expect(extractUserIdFromPersistedSession(JSON.stringify({ access_token: "a" }))).toBeNull();
    expect(extractUserIdFromPersistedSession(JSON.stringify({ user: {} }))).toBeNull();
    expect(extractUserIdFromPersistedSession(JSON.stringify({ user: { id: 123 } }))).toBeNull();
    expect(extractUserIdFromPersistedSession(JSON.stringify({ user: { id: "" } }))).toBeNull();
  });

  test("returns null for valid-but-irrelevant JSON (array, string, null literal)", () => {
    expect(extractUserIdFromPersistedSession("[]")).toBeNull();
    expect(extractUserIdFromPersistedSession('"hello"')).toBeNull();
    expect(extractUserIdFromPersistedSession("null")).toBeNull();
  });
});
