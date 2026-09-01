// Split out of app.js: keeping the open-Hatches feed in sync with the
// backend — a passive cache refresh plus the user-triggered "refresh" button
// on the browse toolbar. Depends on app/backend-client.js (backendFetch),
// loaded earlier. render is still defined later in the app.js trunk, so
// that call goes through window.SkillNestApp.render() instead of a
// destructure.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { backendFetch } = window.SkillNestApp;
  let openHatchesRefreshInFlight = false;

  async function refreshOpenHatches() {
    if (openHatchesRefreshInFlight) return;
    openHatchesRefreshInFlight = true;
    const data = await backendFetch("/api/hatches");
    openHatchesRefreshInFlight = false;
    if (!data?.ok) return;
    const cache = JSON.stringify(data.hatches);
    if (cache !== localStorage.getItem("hatchOpenHatchesCache")) {
      localStorage.setItem("hatchOpenHatchesCache", cache);
      window.SkillNestApp.render();
    }
  }

  let browseRefreshStatusTimer = null;
  function flashBrowseRefreshStatus(text) {
    const note = document.getElementById("browseRefreshStatus");
    if (!note) return;
    note.textContent = text;
    note.classList.add("show");
    window.clearTimeout(browseRefreshStatusTimer);
    browseRefreshStatusTimer = window.setTimeout(() => note.classList.remove("show"), 2200);
  }

  // User-triggered feed refresh from the browse toolbar button. Unlike the
  // passive refreshOpenHatches() above (which stays silent when nothing
  // changed), this always gives feedback: the icon spins while fetching, then
  // the feed either re-renders with the newest Hatches or flashes a short note.
  async function refreshBrowse() {
    const btn = document.querySelector(".browse-refresh");
    if (btn) { btn.disabled = true; btn.classList.add("is-refreshing"); }
    openHatchesRefreshInFlight = false; // force a fetch even if one just ran
    const data = await backendFetch("/api/hatches");
    if (data?.ok) {
      const cache = JSON.stringify(data.hatches);
      const changed = cache !== localStorage.getItem("hatchOpenHatchesCache");
      localStorage.setItem("hatchOpenHatchesCache", cache);
      if (changed) { window.SkillNestApp.render(); return; } // render() rebuilds a fresh button
    }
    // No change (or the backend was unreachable): stop the spinner in place so
    // the click never feels like it did nothing.
    if (btn) { btn.disabled = false; btn.classList.remove("is-refreshing"); }
    flashBrowseRefreshStatus(data?.ok ? "Up to date" : "Couldn't reach the server");
  }

  return {
    refreshOpenHatches,
    refreshBrowse,
  };
})());
