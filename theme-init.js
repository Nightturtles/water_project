(function(){
  var p;
  try { p = localStorage.getItem("cw_theme"); } catch(e) { p = null; }
  p = p || "system";
  var r = p === "system"
    ? (window.matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light")
    : p;
  document.documentElement.setAttribute("data-theme", r);
  // Native iOS only: tell the shell the in-app theme ("system"/"light"/"dark")
  // so it can match overrideUserInterfaceStyle and avoid a mismatched-color
  // flash between pages when the app theme differs from the OS appearance.
  // No-op on web / Android (webkit.messageHandlers is absent).
  try {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.cwTheme) {
      window.webkit.messageHandlers.cwTheme.postMessage(p);
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
    var gate = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.cwNavGate;
    if (gate) {
      window.addEventListener("pageswap", function (e) {
        // Only hold when a view transition was actually captured (same-origin
        // nav, not a reload); otherwise the release may never come.
        if (e.viewTransition) gate.postMessage("hold");
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
