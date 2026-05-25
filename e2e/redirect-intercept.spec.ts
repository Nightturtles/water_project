import { test, expect } from "@playwright/test";

// Codifies the web-side guard that PR k made load-bearing:
//
// Before PR k, no app code imported @capacitor/core, so window.Capacitor was
// undefined in the browser and isNativePlatform() in src/lib/supabase-client.ts
// returned false trivially. PR k bundles five Capacitor plugins (haptics,
// share, status bar, splash screen, app) and the bootstrap module imports
// @capacitor/core, which means window.Capacitor IS defined on the public web
// build — but its isNativePlatform() must still return false so the OAuth /
// password-reset redirectTo stays at cafelytic.com URLs (the browser can't
// open cafelytic:// links anyway, and Supabase would reject the redirect).
//
// If a future change ever flips isNativePlatform() to true on web (e.g. by
// switching to a server-rendered shell that always reports native), this
// spec breaks LOUDLY rather than letting cafelytic://auth-callback leak into
// browser-side OAuth requests.

test.describe("OAuth redirect intercept — Capacitor on web stays browser-routed", () => {
  test("window.Capacitor is defined but isNativePlatform() returns false on the web build", async ({
    page,
  }) => {
    await page.goto("/login.html");

    const state = await page.evaluate(() => {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor;
      return {
        capacitorDefined: !!cap,
        hasIsNativePlatform: typeof cap?.isNativePlatform === "function",
        isNativePlatform:
          typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : null,
      };
    });

    expect(state.capacitorDefined, "PR k imports @capacitor/core; window.Capacitor must exist").toBe(
      true,
    );
    expect(state.hasIsNativePlatform).toBe(true);
    expect(
      state.isNativePlatform,
      "isNativePlatform() must return false in a real browser",
    ).toBe(false);
  });

  test("signInWithGoogle calls signInWithOAuth with redirectTo = https://cafelytic.com/login.html", async ({
    page,
  }) => {
    await page.goto("/login.html");

    const capturedRedirect = await page.evaluate(async () => {
      // Wait until supabase-client.ts has populated window.supabaseClient and
      // resolved its initial getSession(). cw:auth-state-resolved fires from
      // supabase-client.ts on either success or failure.
      await new Promise<void>((resolve) => {
        if ((window as Window & { _authStateResolved?: boolean })._authStateResolved) {
          resolve();
          return;
        }
        document.addEventListener("cw:auth-state-resolved", () => resolve(), { once: true });
      });

      // Replace the instance method with a capture stub. Reassigning shadows
      // the prototype binding, so the real Supabase request never fires and
      // we don't navigate away from the test page.
      let captured: string | null = null;
      const auth = window.supabaseClient.auth as unknown as {
        signInWithOAuth: (opts: { provider: string; options?: { redirectTo?: string } }) => Promise<{
          data: null;
          error: null;
        }>;
      };
      auth.signInWithOAuth = function (opts) {
        captured = opts?.options?.redirectTo ?? null;
        return Promise.resolve({ data: null, error: null });
      };

      const signIn = (window as unknown as { signInWithGoogle?: () => Promise<unknown> })
        .signInWithGoogle;
      if (typeof signIn !== "function") {
        return { error: "signInWithGoogle missing" };
      }
      await signIn();
      return { redirectTo: captured };
    });

    expect(capturedRedirect).toEqual({ redirectTo: "https://cafelytic.com/login.html" });
  });

  test("resetPasswordForEmail uses https://cafelytic.com/reset-password.html on web", async ({
    page,
  }) => {
    await page.goto("/login.html");

    const captured = await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        if ((window as Window & { _authStateResolved?: boolean })._authStateResolved) {
          resolve();
          return;
        }
        document.addEventListener("cw:auth-state-resolved", () => resolve(), { once: true });
      });

      let capturedRedirect: string | null = null;
      const auth = window.supabaseClient.auth as unknown as {
        resetPasswordForEmail: (
          email: string,
          opts?: { redirectTo?: string },
        ) => Promise<{ data: null; error: null }>;
      };
      auth.resetPasswordForEmail = function (_email, opts) {
        capturedRedirect = opts?.redirectTo ?? null;
        return Promise.resolve({ data: null, error: null });
      };

      const reset = (
        window as unknown as { resetPasswordForEmail?: (email: string) => Promise<unknown> }
      ).resetPasswordForEmail;
      if (typeof reset !== "function") return { error: "resetPasswordForEmail missing" };
      await reset("test@example.com");
      return { redirectTo: capturedRedirect };
    });

    expect(captured).toEqual({ redirectTo: "https://cafelytic.com/reset-password.html" });
  });
});
