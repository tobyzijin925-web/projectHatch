// Split out of app.js: the admin-controlled site-stats banner (defaults,
// read, live preview, save) and the admin dashboard actions (combined hatch
// list, application review, hatch deletion, direct messaging). Depends on
// app/backend-client.js (loaded earlier). render is still defined later in
// the app.js trunk, so those calls go through window.SkillNestApp.render()
// instead of a destructure.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const C = window.SkillNestComponents;
  const {
    readJson, backendFetch, backendToken, getAccount, getPostedTasks, marketplaceTasks, postedTasksKey,
  } = window.SkillNestApp;

  function getAdminData() {
    return readJson("hatchAdminCache", { applications: [], hatches: [] });
  }

  // ── Site stats banner ──────────────────────────────────────────────────
  // Admin-set numbers behind the rolling banner. The backend is the source of
  // truth (so every visitor sees the same figures), but a localStorage cache
  // lets the banner render instantly and survive the backend being offline.
  // Defaults mirror defaultSiteStats() in hatchApi.js.
  const SITE_STATS_DEFAULTS = {
    people: 200,
    openHatches: 45,
    activeHatchers: 120,
    activeClients: 80,
    hatchesLastWeek: 60,
    previewMode: true,
    // Admin-controlled: show the grey "Posted … ago" line on browse cards.
    showCardAge: true,
    // Admin-controlled: show AI debugging output (the debug panel + console
    // logs). Off by default so a plain visitor never sees intake internals.
    aiDebug: false,
  };

  function getSiteStats() {
    return { ...SITE_STATS_DEFAULTS, ...readJson("hatchSiteStats", {}) };
  }

  // The banner is a marketing/top-of-funnel element, so it shows only on the
  // public marketing pages, the browse directories, and the auth screens —
  // never on the logged-in workspace (messages, settings, profile) or inside
  // the post-a-Hatch flow.
  const BANNER_ROUTES = new Set([
    "home", "how-it-works", "about", "verified-work", "operator",
    "browse", "operators", "clients",
    "auth", "signup",
  ]);

  function bannerMarkupFor(route) {
    return BANNER_ROUTES.has(route) ? C.statsBanner(getSiteStats()) : "";
  }

  // Swaps just the banner element for a fresh one. Used instead of a full
  // render() so a background stats refresh (or the admin's own save) never
  // wipes the page the admin is editing — the form, its focus, and its "Saved"
  // message all survive.
  function updateBannerInPlace() {
    const existing = document.querySelector(".stats-banner");
    if (!existing) return;
    const holder = document.createElement("div");
    holder.innerHTML = C.statsBanner(getSiteStats());
    const fresh = holder.firstElementChild;
    if (fresh) existing.replaceWith(fresh);
  }

  async function refreshSiteStats() {
    const data = await backendFetch("/api/site-stats");
    if (!data?.ok || !data.stats) return;
    const next = JSON.stringify(data.stats);
    if (next !== localStorage.getItem("hatchSiteStats")) {
      localStorage.setItem("hatchSiteStats", next);
      updateBannerInPlace();
    }
  }

  // Reads the admin form into a stats object. Used both for the live inline
  // preview and for the actual save.
  function statsFromForm() {
    const num = (id) => Number(document.getElementById(id)?.value || 0);
    return {
      people: num("statPeople"),
      openHatches: num("statOpenHatches"),
      activeHatchers: num("statActiveHatchers"),
      activeClients: num("statActiveClients"),
      hatchesLastWeek: num("statHatchesLastWeek"),
      previewMode: Boolean(document.getElementById("statPreviewMode")?.checked),
      showCardAge: Boolean(document.getElementById("statShowCardAge")?.checked),
      aiDebug: Boolean(document.getElementById("statAiDebug")?.checked),
    };
  }

  // Live-updates the inline preview inside the admin card as the numbers or the
  // switch change, so the switch has an immediate, visible effect even though
  // the real banner doesn't render on this page.
  function previewSiteStatsBanner() {
    const container = document.getElementById("statsBannerPreview");
    if (!container) return;
    const holder = document.createElement("div");
    holder.innerHTML = C.statsBanner(statsFromForm());
    const fresh = holder.firstElementChild;
    if (fresh) container.replaceChildren(fresh);
  }

  async function saveSiteStats(event) {
    event.preventDefault();
    const payload = statsFromForm();
    const status = document.getElementById("statsSaveStatus");
    if (status) status.textContent = "Saving…";
    const result = await backendFetch("/api/site-stats", { method: "POST", body: payload });
    if (!result?.ok || !result.stats) {
      if (status) status.textContent = result?.error || "Couldn't save — is the server running and are you signed in as an admin?";
      return;
    }
    localStorage.setItem("hatchSiteStats", JSON.stringify(result.stats));
    if (status) status.textContent = "Saved. The banner is updated for everyone.";
    updateBannerInPlace();
  }

  let adminRefreshInFlight = false;
  async function refreshAdminData() {
    if (!getAccount().isAdmin || !backendToken() || adminRefreshInFlight) return;
    adminRefreshInFlight = true;
    const [applications, hatches] = await Promise.all([
      backendFetch("/api/hatcher-applications?all=1"),
      backendFetch("/api/hatches?state=all"),
    ]);
    adminRefreshInFlight = false;
    if (!applications?.ok && !hatches?.ok) return;
    const cache = JSON.stringify({
      applications: applications?.ok ? applications.applications : getAdminData().applications,
      hatches: hatches?.ok ? hatches.hatches : getAdminData().hatches,
    });
    if (cache !== localStorage.getItem("hatchAdminCache")) {
      localStorage.setItem("hatchAdminCache", cache);
      window.SkillNestApp.render();
    }
  }

  // One list covering everything an admin can see: hatches posted in this
  // browser, demo seed hatches, and hatches that only exist on the backend.
  function adminHatchList() {
    const posted = new Set(getPostedTasks().map((task) => task.id));
    const locals = marketplaceTasks().map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      level: task.level,
      business: task.business,
      backendId: task.backendId || "",
      source: posted.has(task.id) ? "posted" : "seed",
    }));
    const known = new Set(locals.map((task) => task.backendId).filter(Boolean));
    const remoteOnly = getAdminData().hatches
      .filter((hatch) => !known.has(hatch.id))
      .map((hatch) => ({
        id: hatch.id,
        title: hatch.title,
        status: hatch.status,
        level: hatch.level,
        business: hatch.createdBy?.name || hatch.createdBy?.username || hatch.business || "",
        backendId: hatch.id,
        source: "backend",
      }));
    return [...locals, ...remoteOnly];
  }

  async function adminReviewApplication(id, decision) {
    const note = document.getElementById(`adminAppNote-${id}`)?.value.trim() || "";
    const result = await backendFetch(`/api/hatcher-applications/${id}/review`, {
      method: "POST",
      body: { decision, message: note },
    });
    localStorage.setItem("hatchProfileNotice", result?.ok
      ? `Application ${decision === "approve" ? "approved" : "rejected"}. The applicant was notified in their inbox.`
      : result?.error || "The backend is unreachable, so the application was not reviewed.");
    await refreshAdminData();
    window.SkillNestApp.render();
  }

  async function adminDeleteHatch(id) {
    if (!window.confirm("Delete this Hatch for everyone?")) return;
    const entry = adminHatchList().find((item) => item.id === id);
    let notice = "Hatch deleted.";
    if (entry?.backendId) {
      const result = await backendFetch(`/api/hatches/${encodeURIComponent(entry.backendId)}`, { method: "DELETE" });
      if (result?.ok) notice = "Hatch deleted. The people on it were notified in their inbox.";
      else if (result) notice = result.error || "The backend refused to delete this Hatch.";
    }
    if (entry?.source === "posted") {
      localStorage.setItem(postedTasksKey(), JSON.stringify(getPostedTasks().filter((task) => task.id !== id)));
    } else if (entry?.source === "seed") {
      const removed = readJson("hatchRemovedSeedTasks", []);
      if (!removed.includes(id)) removed.push(id);
      localStorage.setItem("hatchRemovedSeedTasks", JSON.stringify(removed));
    }
    localStorage.setItem("hatchProfileNotice", notice);
    await refreshAdminData();
    window.SkillNestApp.render();
  }

  async function adminSendMessage(event) {
    event.preventDefault();
    const to = document.getElementById("adminMessageTo")?.value.trim() || "";
    const subject = document.getElementById("adminMessageSubject")?.value.trim() || "";
    const body = document.getElementById("adminMessageBody")?.value.trim() || "";
    const result = await backendFetch("/api/admin/messages", { method: "POST", body: { to, subject, body } });
    localStorage.setItem("hatchProfileNotice", result?.ok
      ? `Message sent to ${result.to}.`
      : result?.error || "The backend is unreachable, so the message was not sent.");
    window.SkillNestApp.render();
  }

  return {
    getAdminData,
    getSiteStats,
    bannerMarkupFor,
    refreshSiteStats,
    previewSiteStatsBanner,
    saveSiteStats,
    refreshAdminData,
    adminHatchList,
    adminReviewApplication,
    adminDeleteHatch,
    adminSendMessage,
  };
})());
