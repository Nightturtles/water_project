(function () {
  var MEASUREMENT_ID = "G-BGJWVRGJJC";
  var urlOptOut = false;
  try {
    var params = new URLSearchParams(location.search);
    if (params.has("no-analytics")) {
      var v = params.get("no-analytics");
      if (v === "1") {
        urlOptOut = true;
        try {
          localStorage.setItem("cafelytic_no_analytics", "1");
        } catch (e) {}
      } else if (v === "0") {
        try {
          localStorage.removeItem("cafelytic_no_analytics");
        } catch (e) {}
      }
      params.delete("no-analytics");
      var q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    }
  } catch (e) {}
  if (urlOptOut) return;
  var h = location.hostname;
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "[::1]" ||
    h === ""
  )
    return;
  if (navigator.webdriver === true) return;
  try {
    if (localStorage.getItem("cafelytic_no_analytics") === "1") return;
  } catch (e) {}
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
})();
