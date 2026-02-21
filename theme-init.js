(function(){
  var p;
  try { p = localStorage.getItem("cw_theme"); } catch(e) { p = null; }
  p = p || "system";
  var r = p === "system"
    ? (window.matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light")
    : p;
  document.documentElement.setAttribute("data-theme", r);
})();
