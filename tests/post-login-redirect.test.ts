// After sign-in, login.html may send the user back to the OAuth consent page.
// That destination must never be steerable to anywhere else: these tests pin
// the allowlist.

import { test, expect, beforeEach } from "vitest";
import {
  consentReturnPath,
  rememberPostLoginRedirect,
  takePostLoginRedirect,
} from "../src/lib/post-login-redirect";

beforeEach(() => {
  sessionStorage.clear();
});

test("round trip: a consent return path is stored, returned once, then cleared", () => {
  const path = consentReturnPath("4b4umfdtv6miv3xn4jcvmhyajmkepokz");
  expect(path).toBe("oauth/consent?authorization_id=4b4umfdtv6miv3xn4jcvmhyajmkepokz");
  expect(rememberPostLoginRedirect(path)).toBe(true);
  expect(takePostLoginRedirect()).toBe(path);
  expect(takePostLoginRedirect()).toBeNull();
});

test("an authorization id with URL syntax in it is refused", () => {
  for (const id of ["", "a b", "x&next=//evil.example", "x#frag", "../login", "x/y", "x?y", "é"]) {
    expect(consentReturnPath(id)).toBeNull();
  }
});

test("nothing but the consent page can be stored", () => {
  for (const path of [
    "https://evil.example/",
    "//evil.example/",
    "/oauth/consent?authorization_id=abc",
    "index.html",
    "oauth/consent",
    "oauth/consent?authorization_id=abc&x=1",
    "javascript:alert(1)",
  ]) {
    expect(rememberPostLoginRedirect(path)).toBe(false);
  }
  expect(takePostLoginRedirect()).toBeNull();
});

test("a value planted in storage directly is not honored", () => {
  sessionStorage.setItem("cw_post_login_redirect", "https://evil.example/");
  expect(takePostLoginRedirect()).toBeNull();
  // And it is cleared, so it cannot linger for a later sign-in.
  expect(sessionStorage.getItem("cw_post_login_redirect")).toBeNull();
});
