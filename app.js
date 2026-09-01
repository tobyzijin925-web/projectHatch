window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { operators, clients, completedHatches, operatorProfiles } = window.SkillNestData;
  const C = window.SkillNestComponents;
  const Pages = window.SkillNestPages;
  // Provided by app/theme-language.js, app/backend-client.js,
  // app/task-store.js, app/intake-assistant.js, app/directory-filters.js,
  // app/work-submissions.js, app/operator-application.js, app/browse.js, and
  // app/messaging.js, all loaded just before this file.
  const {
    currentRoute, setRoute, applyDarkModePreference, toggleDarkMode, toggleLanguageMenu,
    closeLanguageMenu, toggleBrowseMenu, closeBrowseMenu, chooseLanguage, showLanguageGate,
    chooseInitialLanguage, dismissLanguageGate, setContentLanguage, setForeignHatchHandling,
    syncContentPrefsFromAccount, hydrateTaskTranslations, toggleTaskOriginal,
    readJson, backendUrl, backendToken, backendFetch, storeBackendSession, backendPassword,
    refreshBackendAccount, getAccount, accountScopeId, scopedKey, migrateLegacyKey,
    postedTasksKey, missionsKey, getMissions, getPostedTasks, hydrateSessionFiles,
    marketplaceTasks, getRemoteOpenHatches, normalizeRemoteHatch, browsableTasks,
    getOperatorApplications, isLoggedIn,
    trySetLocalStorage, saveListItem, saveDraftTask, getGeneratedBrief, operatorRecommendationContext,
    accountRoute, aiDebugLog, animateAssistantTyping, answerClarification, attachComposeFile,
    attachReferenceMaterial, cancelBriefEdit, clearTaskDraft, completeReferenceFiles, confirmSection,
    continueChattingFromFinal, deleteVoiceTranscript, downloadDraftFile, downloadTaskFile,
    editBriefField, editFinalSection, editSection, getAssistantMessages, handleAssistantReplyKey,
    handleAssistantTurn, handleTaskFiles, moveToNextSection, normalizeConfidence, openHatchReview,
    pauseVoiceInput, previewDraftFile, previewTaskFile, readFileAsDataUrl, removeDraftFile,
    removePostedTaskFile, renderFilePreviews, rewriteSection, saveHatchDraft, sendAssistantReply,
    simulateVoiceInput, startHeroTypewriter, startNewHatch, startTaskFlow, stopVoiceInput,
    submitReviewedHatch, toggleFinalEditList, toggleVoiceInput, updateBriefField,
    updateDraftFileLabel, updateLiveTaskPreview, updateSection, useExampleTask, useTaskChip,
    applyTaskFilters, applyOperatorFilters, applyClientFilters, clientRecommendationContext,
    syncMissionCardStates, getPublishedResults, getOperatorWizard, refreshApplicationStatus,
    refreshOpenHatches,
    getMessagingThread, getMessagingFilter, getConversations, getMessagesUnread,
    refreshConversations, reloadActiveThread,
  } = window.SkillNestApp;
  function toggleProfileMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById("profileMenu");
    if (!menu) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    document.querySelector(".avatar-button")?.setAttribute("aria-expanded", String(willOpen));
  }

  function closeProfileMenu() {
    const menu = document.getElementById("profileMenu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      document.querySelector(".avatar-button")?.setAttribute("aria-expanded", "false");
    }
  }

  document.addEventListener("click", (event) => {
    // Outside clicks close the menu; so do its navigation links (which fire
    // no hashchange when the target route is already active). The Appearance
    // toggle is a <button>, so it stays open for repeated flips.
    if (!event.target.closest(".profile-menu-wrap") || event.target.closest(".profile-menu a")) closeProfileMenu();
    if (!event.target.closest(".language-picker")) closeLanguageMenu();
    if (!event.target.closest(".nav-browse-dropdown") || event.target.closest(".nav-browse-menu a")) closeBrowseMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeProfileMenu();
      closeLanguageMenu();
      closeBrowseMenu();
    }
  });

  // Theme toggle inside the dropdown: flips the theme in place (same reason
  // as toggleDarkMode — no full render) and relabels itself.
  function toggleDarkModeFromMenu() {
    toggleDarkMode();
    const isDark = document.documentElement.classList.contains("dark-mode");
    const label = document.querySelector("[data-appearance-label]");
    if (label) label.textContent = `Appearance: ${isDark ? "Dark" : "Light"}`;
    const icon = document.querySelector("[data-appearance-icon]");
    if (icon) icon.textContent = isDark ? "☾" : "☀";
  }

  // ── Account settings ───────────────────────────────────────────────────────

  function storeAccountFields(account) {
    const current = readJson("skillnestAccount", {});
    localStorage.setItem("skillnestAccount", JSON.stringify({ ...current, ...account }));
  }

  // Downscale to a small square so avatars stay a few KB — kind to both the
  // users table and the localStorage copy of the account.
  function resizeImageToDataUrl(file, maxSize = 256) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85));
        };
        img.onerror = () => reject(new Error("That file couldn't be read as an image."));
        img.src = String(reader.result || "");
      };
      reader.onerror = () => reject(new Error("That file couldn't be read."));
      reader.readAsDataURL(file);
    });
  }

  async function handleAvatarFile(event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Choose an image file for your profile picture.");
      return;
    }
    let avatarData;
    try {
      avatarData = await resizeImageToDataUrl(file);
    } catch (error) {
      window.alert(error.message || "That image couldn't be processed.");
      return;
    }
    const result = await backendFetch("/api/auth/profile", { method: "POST", body: { avatarData } });
    if (!result?.ok) {
      window.alert(result?.error || "The backend is unreachable, so your picture wasn't saved.");
      return;
    }
    storeAccountFields(result.account);
    localStorage.setItem("hatchSettingsNotice", "Profile picture updated.");
    render();
    window.setTimeout(() => {
      localStorage.removeItem("hatchSettingsNotice");
    }, 4000);
  }

  async function removeAvatar() {
    const result = await backendFetch("/api/auth/profile", { method: "POST", body: { removeAvatar: true } });
    if (!result?.ok) {
      window.alert(result?.error || "The backend is unreachable, so your picture wasn't removed.");
      return;
    }
    storeAccountFields(result.account);
    localStorage.removeItem("hatchSettingsNotice");
    render();
  }

  async function saveAccountSettings(event) {
    event.preventDefault();
    const name = document.getElementById("settingsName")?.value.trim() || "";
    if (!name) return;
    const result = await backendFetch("/api/auth/profile", { method: "POST", body: { name } });
    if (!result?.ok) {
      window.alert(result?.error || "The backend is unreachable, so your changes weren't saved.");
      return;
    }
    storeAccountFields(result.account);
    localStorage.setItem("hatchSettingsNotice", "Display name saved.");
    render();
    window.setTimeout(() => {
      localStorage.removeItem("hatchSettingsNotice");
    }, 4000);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

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
      render();
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
    render();
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
    render();
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
    render();
  }

  function finishOperatorWizard(route) {
    localStorage.removeItem("hatchOperatorStep");
    localStorage.removeItem("hatchOperatorDraft");
    setRoute(route);
  }

  // Cards rendered from the backend's open-hatch feed (someone else's Hatch,
  // discovered only through refreshOpenHatches — see browsableTasks()) don't
  // exist in marketplaceTasks(), which is local-only. Fall back to the same
  // remote cache so opening/applying to one of those cards still works.
  function findAnyTask(taskId) {
    return marketplaceTasks().find((item) => item.id === taskId)
      || getRemoteOpenHatches().map(normalizeRemoteHatch).find((item) => item.id === taskId);
  }

  function openTaskDetail(taskId) {
    const task = findAnyTask(taskId);
    if (task) openModal(C.taskDetail(task));
  }

  function openOperatorProfile(operatorId) {
    const operator = operators.find((item) => item.id === operatorId);
    if (operator) openModal(C.operatorDetail(operator));
  }

  // Verified Results shown on the page are the client-published records first,
  // then the seeded demo Hatches — so look in both when opening or sharing one.
  function findVerifiedWork(workId) {
    return getPublishedResults().find((item) => item.id === workId)
      || completedHatches.find((item) => item.id === workId);
  }

  function openVerifiedProject(workId) {
    const work = findVerifiedWork(workId);
    if (work) openModal(C.verifiedProjectDetail(work));
  }

  function openVerifiedOperatorProfile(profileId) {
    const profile = operatorProfiles.find((item) => item.id === profileId);
    if (profile) openModal(C.verifiedOperatorProfile(profile));
  }

  function shareToast(message) {
    let toast = document.getElementById("shareToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "shareToast";
      toast.className = "share-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(shareToast.timeoutId);
    shareToast.timeoutId = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  async function shareVerifiedWork(workId) {
    const work = findVerifiedWork(workId);
    if (!work) return;

    const shareUrl = `${window.location.origin}${window.location.pathname}#verified-work`;
    const shareText = `${work.title}\n${work.outcome}\n${shareUrl}`;
    const payload = {
      title: `Hatch Verified Results: ${work.title}`,
      text: work.outcome,
      url: shareUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(payload);
        shareToast("Share sheet opened.");
        return;
      }
      await navigator.clipboard.writeText(shareText);
      shareToast("Share text copied.");
    } catch (error) {
      if (error?.name === "AbortError") return;
      shareToast("Share was not available.");
    }
  }

  function openModal(markup) {
    let root = document.getElementById("modalRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "modalRoot";
      document.body.appendChild(root);
    }
    root.innerHTML = markup;
    window.HatchI18n?.apply(root);
  }

  function closeModal() {
    const root = document.getElementById("modalRoot");
    if (root) root.innerHTML = "";
  }

  function showOperatorTab(event, tabName) {
    const panel = event.currentTarget.closest(".modal-panel");
    panel?.querySelectorAll(".operator-tabs .tab").forEach((tab) => tab.classList.remove("active"));
    event.currentTarget.classList.add("active");
    panel?.querySelectorAll("[data-tab-panel]").forEach((item) => {
      item.classList.toggle("show", item.dataset.tabPanel === tabName);
    });
  }

  async function testDeepSeekConnection() {
    const startedAt = performance.now();
    const result = await window.HatchAIController.testDeepSeekConnection();
    result.responseTimeMs = Math.round(performance.now() - startedAt);
    aiDebugLog("[Hatch AI] DeepSeek connection test", result);
    return result;
  }

  function scrollAssistantToLatest() {
    if (currentRoute() !== "task-review") return;
    const thread = document.getElementById("assistantThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
    const reply = document.getElementById("assistantReply");
    if (reply && typeof reply.scrollIntoView === "function") reply.scrollIntoView({ block: "nearest" });
  }

  function render() {
    const route = currentRoute();
    const account = getAccount();
    const files = readJson("skillnestDraftFiles", []);
    const draftTask = localStorage.getItem("skillnestDraftTask") || "";
    const generatedBrief = getGeneratedBrief();
    const page = (route === "create-hatch" || route === "post-task")
      ? Pages.createHatchPage(account, draftTask, files)
      : route === "auth"
        ? Pages.authPage()
      : route === "signup"
        ? Pages.signupPage()
      : route === "task-review"
        ? Pages.taskReviewPage(draftTask, files, generatedBrief, getAssistantMessages())
      : route === "hatch-review"
        ? Pages.hatchReviewPage(files, generatedBrief)
      : route === "operator"
        ? Pages.operatorPage(account, getOperatorWizard(), isLoggedIn())
      : route === "how-it-works"
        ? Pages.howItWorksPage()
      : route === "about"
        ? Pages.aboutPage()
      : route === "browse"
        ? Pages.browsePage(browsableTasks())
      : route === "operators"
        ? Pages.findOperatorsPage(operators, operatorRecommendationContext())
      : route === "clients"
        ? Pages.findClientsPage(clients, clientRecommendationContext())
      : route === "terms"
        ? Pages.termsPage()
      : route === "privacy"
        ? Pages.privacyPage()
      : route === "verified-work"
        ? Pages.verifiedWorkPage(getPublishedResults())
      : route === "messages"
        ? (isLoggedIn()
          ? Pages.messagesPage(account, {
            conversations: getConversations(),
            activeId: getMessagingThread().conversationId,
            conversation: getMessagingThread().conversation,
            messages: getMessagingThread().messages,
            loading: getMessagingThread().loading,
            filter: getMessagingFilter(),
          })
          : Pages.authPage())
      : route === "settings"
        ? (isLoggedIn() ? Pages.settingsPage(account) : Pages.authPage())
      : route === "profile"
        ? (isLoggedIn()
          ? Pages.profilePage(account, getPostedTasks(), getMissions(), getOperatorApplications(), getMessagesUnread(), getAdminData(), account.isAdmin ? adminHatchList() : [])
          : Pages.authPage())
      : Pages.homePage(draftTask, files);

    // Profile data lives on the backend; kick off refreshes that re-render
    // only when the cached copy is stale.
    if (route === "profile" && isLoggedIn()) {
      refreshConversations();
      refreshApplicationStatus();
      refreshAdminData();
    }
    if (route === "messages" && isLoggedIn()) {
      refreshConversations();
      // Re-entering with a thread already open: catch up on messages that
      // arrived while the poll was paused on other routes.
      reloadActiveThread();
    }
    if (route === "browse") refreshOpenHatches();

    // Two bits of ephemeral UI state must survive the innerHTML swap: an open
    // profile dropdown (background polls would otherwise snap it shut), and
    // the reader's place in a scrolled-up thread.
    const menuWasOpen = document.getElementById("profileMenu")?.hidden === false;
    const prevThread = document.getElementById("threadBody");
    const prevScroll = prevThread
      ? {
        top: prevThread.scrollTop,
        atBottom: prevThread.scrollHeight - prevThread.scrollTop - prevThread.clientHeight < 40,
      }
      : null;

    document.getElementById("app").innerHTML = `<div class="app-shell">${C.nav(route, isLoggedIn(), account)}${bannerMarkupFor(route)}<div class="page-enter">${page}</div>${C.footer(isLoggedIn(), account)}</div>`;
    // Pages render in English; translate the fresh tree in place before paint.
    window.HatchI18n?.apply(document.getElementById("app"));
    if (menuWasOpen) {
      const menu = document.getElementById("profileMenu");
      if (menu) {
        menu.hidden = false;
        document.querySelector(".avatar-button")?.setAttribute("aria-expanded", "true");
      }
    }
    requestAnimationFrame(() => {
      document.querySelectorAll(".reveal, .page-enter").forEach((el) => el.classList.add("visible"));
      syncMissionCardStates();
      renderFilePreviews();
      scrollAssistantToLatest();
      animateAssistantTyping();
      startHeroTypewriter();
      // Filters first, so hydration knows which cards are actually on screen
      // and skips paying to translate ones the reader filtered away.
      if (route === "browse") applyTaskFilters();
      if (route === "operators") applyOperatorFilters();
      if (route === "clients") applyClientFilters();
      hydrateTaskTranslations();
      if (route === "messages") {
        const thread = document.getElementById("threadBody");
        // Snap to the newest message on first open or when already reading
        // the bottom; otherwise restore the reader's scroll position.
        if (thread) thread.scrollTop = (!prevScroll || prevScroll.atBottom) ? thread.scrollHeight : prevScroll.top;
      }
    });
  }

  window.addEventListener("hashchange", render);

  return {
    closeModal,
    findAnyTask,
    openModal,
    finishOperatorWizard,
    openOperatorProfile,
    openTaskDetail,
    openVerifiedOperatorProfile,
    openVerifiedProject,
    render,
    toggleProfileMenu,
    toggleDarkModeFromMenu,
    handleAvatarFile,
    removeAvatar,
    saveAccountSettings,
    adminReviewApplication,
    adminDeleteHatch,
    adminSendMessage,
    saveSiteStats,
    refreshSiteStats,
    getSiteStats,
    previewSiteStatsBanner,
    shareVerifiedWork,
    showOperatorTab,
    testDeepSeekConnection,
  };
})());

SkillNestApp.applyDarkModePreference();
SkillNestApp.syncContentPrefsFromAccount();
SkillNestApp.render();
SkillNestApp.showLanguageGate();
// Pick up server-side account changes (role upgrades, admin flag) at boot.
window.setTimeout(() => SkillNestApp.refreshBackendAccount(), 300);
// Pull the latest banner stats from the backend (public, no auth needed).
window.setTimeout(() => SkillNestApp.refreshSiteStats(), 300);
window.testDeepSeekConnection = SkillNestApp.testDeepSeekConnection;
