// Which pages report to Sentry, and as what (src/lib/sentry-init.ts). In Node
// `location` is undefined, so importing the module binds the helper and starts
// no client.

import { describe, test, expect } from "vitest";
import { sentryEnvironment } from "../src/lib/sentry-init";

describe("sentryEnvironment", () => {
  test("the live site and the native apps report as production", () => {
    expect(sentryEnvironment("https:", "cafelytic.com", false)).toBe("production");
    // iOS and Android shells: "localhost", but not over http.
    expect(sentryEnvironment("capacitor:", "localhost", false)).toBe("production");
    expect(sentryEnvironment("https:", "localhost", false)).toBe("production");
  });

  test("the dev server, vite preview and e2e runs report nothing", () => {
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]) {
      expect(sentryEnvironment("http:", host, false)).toBeNull();
    }
  });

  test("a local run that opted in reports as development", () => {
    expect(sentryEnvironment("http:", "localhost", true)).toBe("development");
    // The opt-in changes nothing off a local origin.
    expect(sentryEnvironment("https:", "cafelytic.com", true)).toBe("production");
  });
});
