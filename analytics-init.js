(function () {
  var MEASUREMENT_ID = "G-BGJWVRGJJC";

  // Apply the ?no-analytics=<v> URL param to localStorage and strip it from
  // the URL via history.replaceState. Returns true iff the request was an
  // explicit opt-OUT (value "1") and analytics should be skipped for THIS
  // load. Extracted from the IIFE so the side-effect path is unit-testable.
  function handleOptOutURLParam(search, loc, hist, storage) {
    // optedOutNow lives outside the try so that if hist.replaceState throws
    // *after* we've recorded the opt-out, the return value still reflects the
    // user's intent for this load (matches the original IIFE, where urlOptOut
    // was a captured var rather than a try-block return).
    var optedOutNow = false;
    try {
      var params = new URLSearchParams(search);
      if (!params.has("no-analytics")) return false;
      var v = params.get("no-analytics");
      if (v === "1") {
        optedOutNow = true;
        try {
          storage.setItem("cafelytic_no_analytics", "1");
        } catch (e) {}
      } else if (v === "0") {
        try {
          storage.removeItem("cafelytic_no_analytics");
        } catch (e) {}
      }
      params.delete("no-analytics");
      var q = params.toString();
      hist.replaceState(null, "", loc.pathname + (q ? "?" + q : "") + loc.hash);
    } catch (e) {}
    return optedOutNow;
  }

  // Pure decision: should GA load on this pageview, given the inputs?
  // No side effects; tests drive every branch by varying the env argument.
  function shouldLoadAnalytics(env) {
    if (env.urlOptOut) return false;
    var h = env.hostname;
    if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "::1" ||
      h === "[::1]" ||
      h === ""
    ) {
      return false;
    }
    if (env.webdriver === true) return false;
    try {
      if (env.storage.getItem("cafelytic_no_analytics") === "1") return false;
    } catch (e) {}
    return true;
  }

  // Browser bootstrap. Skipped under Node (no location/history/navigator),
  // which lets the test file require this module without crashing — the
  // require still installs the UMD shim below.
  if (
    typeof location !== "undefined" &&
    typeof history !== "undefined" &&
    typeof navigator !== "undefined"
  ) {
    var urlOptOut = handleOptOutURLParam(location.search, location, history, localStorage);
    if (
      shouldLoadAnalytics({
        urlOptOut: urlOptOut,
        hostname: location.hostname,
        webdriver: navigator.webdriver,
        storage: localStorage,
      })
    ) {
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        window.dataLayer.push(arguments);
      }
      window.gtag = gtag;
      gtag("js", new Date());
      gtag("config", MEASUREMENT_ID);
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
      document.head.appendChild(s);
    }
  }

  // Node/Vitest UMD shim. Exposes the two pure functions for unit tests.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      shouldLoadAnalytics: shouldLoadAnalytics,
      handleOptOutURLParam: handleOptOutURLParam,
    };
  }
})();
