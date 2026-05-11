(function () {
  var MEASUREMENT_ID = "G-BGJWVRGJJC";
  var h = location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "") return;
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
