// @ts-check
(function () {
  /** @type {string | null} */
  let pref = null;
  try {
    pref = localStorage.getItem("cw_theme");
  } catch (e) {}
  const theme = pref || "system";
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme:dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.setAttribute("data-theme", resolved);

  const wk = window.webkit;

  // Native iOS only: tell the shell the in-app theme ("system"/"light"/"dark")
  // so it can match overrideUserInterfaceStyle and avoid a mismatched-color
  // flash between pages when the app theme differs from the OS appearance.
  // No-op on web / Android (webkit.messageHandlers is absent).
  try {
    if (wk && wk.messageHandlers && wk.messageHandlers.cwTheme) {
      wk.messageHandlers.cwTheme.postMessage(theme);
    }
  } catch (e) {}

  // Native iOS only: paint-holding across full-page navigations. WKWebView
  // (unlike Safari) shows a blank themed frame between tearing down the old
  // document and the cross-document view transition's first render, which
  // reads as a flash. On pageswap (old page, transition captured, document
  // still live) we ask the shell to overlay a native snapshot of the current
  // content; on pagereveal + two rAFs (first transition frame presented) the
  // new page asks it to drop the snapshot, revealing the crossfade already
  // running from the same pixels. Old WebKit (no pageswap/pagereveal) and
  // Android/web (no webkit.messageHandlers) skip this entirely.
  try {
    const gate = wk && wk.messageHandlers && wk.messageHandlers.cwNavGate;
    if (gate) {
      window.addEventListener("pageswap", function (e) {
        // Only hold when a view transition was actually captured (same-origin
        // nav, not a reload); otherwise the release may never come.
        // viewTransition is non-standard on PageSwapEvent — read it loosely.
        if (/** @type {any} */ (e).viewTransition) gate.postMessage("hold");
      });
      window.addEventListener("pagereveal", function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            gate.postMessage("release");
          });
        });
      });
    }
  } catch (e) {}
})();
