// Loads the real widget for the bot named in ?client_id=. Kept in its own file because the
// dashboard's Content-Security-Policy (script-src 'self') does not allow inline scripts.
(function () {
  var clientId = new URLSearchParams(location.search).get("client_id") || "";
  var problem = document.getElementById("problem");

  function fail(text) {
    problem.textContent = text;
    problem.style.display = "block";
  }

  // the id ends up in a URL: accept only what a real client id can contain
  if (!/^[a-z0-9-]{2,64}$/.test(clientId)) {
    fail("No bot selected. Open this page with the Preview button in the dashboard.");
    return;
  }
  document.getElementById("bot").textContent = clientId;

  var script = document.createElement("script");
  script.src = "/static/widget.js?client_id=" + encodeURIComponent(clientId);
  script.defer = true;
  script.onerror = function () {
    fail("The widget script could not be loaded from this server.");
  };
  document.body.appendChild(script);

  // The widget stays silent when it may not run (it logs to the console instead), so say it here
  setTimeout(function () {
    if (!document.getElementById("cb-widget-root")) {
      fail("The widget did not start. The bot may be switched off (or its tenant suspended). The browser console has the reason.");
    }
  }, 4000);
})();
