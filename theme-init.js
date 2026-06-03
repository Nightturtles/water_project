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
})();
