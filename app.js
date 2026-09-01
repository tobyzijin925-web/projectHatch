window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { operators, clients, completedHatches, operatorProfiles } = window.SkillNestData;
  const C = window.SkillNestComponents;
  const Pages = window.SkillNestPages;
  // Provided by app/theme-language.js, app/backend-client.js,
  // app/task-store.js, app/intake-assistant.js, app/directory-filters.js,
  // app/work-submissions.js, app/operator-application.js, app/browse.js,
  // app/messaging.js, app/profile.js, and app/admin.js, all loaded just
  // before this file.
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
    getAdminData, bannerMarkupFor, refreshAdminData, adminHatchList,
  } = window.SkillNestApp;

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
