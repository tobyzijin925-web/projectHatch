window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { operators, clients, completedHatches, operatorProfiles } = window.SkillNestData;
  const C = window.SkillNestComponents;
  const Pages = window.SkillNestPages;
  // Provided by app/theme-language.js, app/backend-client.js,
  // app/task-store.js, and app/intake-assistant.js, all loaded just before
  // this file.
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
  } = window.SkillNestApp;
  function finishAuth(account) {
    localStorage.setItem("skillnestLoggedIn", "true");
    if (localStorage.getItem("hatchPendingSubmit") === "true") {
      submitReviewedHatch();
      return;
    }
    const pendingMessageTo = localStorage.getItem("hatchPendingMessageTo");
    if (pendingMessageTo) {
      localStorage.removeItem("hatchPendingMessageTo");
      setRoute(accountRoute(account));
      window.setTimeout(() => messageOperator(pendingMessageTo), 60);
      return;
    }
    if (completePendingMission()) return;
    setRoute(accountRoute(account));
  }

  async function completeLogin(event) {
    event.preventDefault();
    const local = getAccount();
    const usernameOrEmail = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;

    // Backend first, so the session carries server truth (role, isAdmin).
    const result = await backendFetch("/api/auth/login", {
      method: "POST",
      body: { usernameOrEmail, password: backendPassword(password) },
    });
    if (result?.ok) {
      storeBackendSession(result, { password });
      finishAuth(getAccount());
      return;
    }

    // Backend down or unknown account: legacy local check.
    const matchesIdentity = usernameOrEmail === local.username || usernameOrEmail === local.email;
    const matchesPassword = !local.password || password === local.password;
    if (!matchesIdentity || !matchesPassword) {
      document.getElementById("loginError")?.classList.add("show");
      return;
    }
    // Local-only account against a live backend: migrate it so the account
    // (and its inbox) exists server-side from now on.
    if (result !== null) {
      const migrated = await backendFetch("/api/auth/signup", {
        method: "POST",
        body: {
          username: local.username,
          name: local.name,
          email: local.email,
          password: backendPassword(password || local.password || local.username),
          role: local.role,
        },
      });
      if (migrated?.ok) storeBackendSession(migrated, { password });
    }
    finishAuth(getAccount());
  }

  async function completeSignup(event) {
    event.preventDefault();
    // The checkbox is `required`, so the browser normally blocks submit before
    // we get here — but guard anyway in case the field is ever bypassed.
    const termsBox = document.getElementById("authTerms");
    if (termsBox && !termsBox.checked) {
      termsBox.reportValidity?.();
      return;
    }
    const account = {
      username: document.getElementById("authUsername").value.trim(),
      name: document.getElementById("authName").value.trim(),
      email: document.getElementById("authEmail").value.trim(),
      password: document.getElementById("authPassword").value,
      role: document.getElementById("authRole").value,
      joinedAt: new Date().toISOString(),
      // Record consent so it's tied to the version of the terms shown at signup.
      acceptedTermsAt: new Date().toISOString(),
      termsVersion: Pages.LEGAL_VERSION,
    };

    // Language preferences chosen during setup, stored on the account so they
    // follow the user rather than the device.
    const prefs = window.HatchI18n?.setPrefs({
      contentLanguage: document.getElementById("authLanguage")?.value,
      foreignHatches: document.querySelector('input[name="authForeignHatches"]:checked')?.value,
    });
    if (prefs) {
      account.contentLanguage = prefs.contentLanguage;
      account.foreignHatches = prefs.foreignHatches;
    }

    localStorage.setItem("skillnestAccount", JSON.stringify(account));

    let result = await backendFetch("/api/auth/signup", {
      method: "POST",
      body: { ...account, password: backendPassword(account.password) },
    });
    // Already registered on the backend (e.g. new browser): sign in instead.
    if (result && !result.ok) {
      result = await backendFetch("/api/auth/login", {
        method: "POST",
        body: { usernameOrEmail: account.username || account.email, password: backendPassword(account.password) },
      });
    }
    if (result?.ok) storeBackendSession(result, { password: account.password });
    finishAuth(getAccount());
  }

  async function quickTestLogin() {
    const account = {
      username: "test_operator",
      name: "Test Operator",
      email: "test@hatch.local",
      password: "test",
      role: "Client and Operator",
      provider: "Quick test login",
      joinedAt: new Date().toISOString(),
    };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    let result = await backendFetch("/api/auth/login", {
      method: "POST",
      body: { usernameOrEmail: account.username, password: backendPassword(account.password) },
    });
    if (result && !result.ok) {
      result = await backendFetch("/api/auth/signup", {
        method: "POST",
        body: { ...account, password: backendPassword(account.password) },
      });
    }
    if (result?.ok) storeBackendSession(result, { password: account.password, provider: account.provider });
    localStorage.setItem("skillnestLoggedIn", "true");
    if (localStorage.getItem("hatchPendingSubmit") === "true") {
      submitReviewedHatch();
      return;
    }
    if (completePendingMission()) return;
    setRoute("profile");
  }

  function socialLogin() {
    document.getElementById("loginError")?.classList.add("show");
  }

  function logout() {
    if (backendToken()) backendFetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("hatchAuthToken");
    localStorage.removeItem("skillnestLoggedIn");
    clearMessagingState();
    setRoute("home");
    render();
  }

  function toggleChoice(event, button) {
    event.preventDefault();
    const isPressed = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", String(!isPressed));
    button.classList.toggle("selected", !isPressed);
  }

  function addCustomChoice(event, name) {
    event.preventDefault();
    const fieldset = event.currentTarget.closest(".choice-field");
    const input = fieldset?.querySelector(`[name="${name}Other"]`);
    const options = fieldset?.querySelector(".choice-options");
    const value = input?.value.trim();
    if (!value || !options) return;

    const button = document.createElement("button");
    button.className = "choice-pill custom-choice selected";
    button.type = "button";
    button.name = name;
    button.value = value;
    button.setAttribute("aria-pressed", "true");
    button.onclick = (clickEvent) => toggleChoice(clickEvent, button);
    button.innerHTML = `${C.escapeHtml(value)} <span class="remove-choice" onclick="SkillNestApp.removeCustomChoice(event, this)">x</span>`;
    options.appendChild(button);
    input.value = "";
  }

  function removeCustomChoice(event, control) {
    event.preventDefault();
    event.stopPropagation();
    control.closest(".choice-pill")?.remove();
  }

  // Values a range slider outputs when both thumbs are pulled to their extremes
  // mean "no bound"; "Flexible" cards carry this sentinel and pass every range.
  const RANGE_FLEX = String(Number.MAX_SAFE_INTEGER);

  function readRangeSlider(id) {
    const el = document.getElementById(id);
    const minInput = el?.querySelector('[data-role="min"]');
    const maxInput = el?.querySelector('[data-role="max"]');
    if (!minInput || !maxInput) return null;
    let min = Number(minInput.value);
    let max = Number(maxInput.value);
    if (min > max) [min, max] = [max, min];
    const atFullRange = min <= Number(minInput.min) && max >= Number(maxInput.max);
    return { min, max, atFullRange };
  }

  function inRange(valueStr, range) {
    if (!range || range.atFullRange) return true;
    if (valueStr === RANGE_FLEX) return true; // "Flexible" fits any range
    const value = Number(valueStr);
    return value >= range.min && value <= range.max;
  }

  function applyTaskFilters() {
    const query = (document.getElementById("taskSearch")?.value || "").toLowerCase();
    const levels = [...document.querySelectorAll(".level-check:checked")].map((el) => el.value);
    const industry = document.getElementById("industryFilter")?.value || "";
    const sort = document.getElementById("sortFilter")?.value || "";
    const price = readRangeSlider("priceRange");
    const length = readRangeSlider("lengthRange");
    const grid = document.getElementById("browseTaskGrid");
    if (!grid) return;
    const cards = [...grid.querySelectorAll(".task-card")];

    // Capture the original ("Featured") order once so it can be restored later.
    cards.forEach((card, index) => {
      if (card.dataset.order === undefined) card.dataset.order = String(index);
    });

    const sortKey = { price: "price", time: "days", level: "levelNum" }[sort];
    const sortValue = (card) => (sortKey ? Number(card.dataset[sortKey]) : Number(card.dataset.order));
    const ordered = [...cards].sort(
      (a, b) => sortValue(a) - sortValue(b) || Number(a.dataset.order) - Number(b.dataset.order)
    );
    ordered.forEach((card) => grid.appendChild(card));

    // "Hide them" is the only handling mode that filters; translate/original
    // both keep foreign Hatches in the grid and differ only in presentation.
    const prefs = window.HatchI18n?.getPrefs() || {};
    const hideForeign = prefs.foreignHatches === "hide";

    let visibleCount = 0;
    cards.forEach((card) => {
      const isVisible =
        (!query || card.dataset.search.toLowerCase().includes(query)) &&
        (!levels.length || levels.includes(card.dataset.level)) &&
        (!industry || card.dataset.industry === industry) &&
        (!hideForeign || card.dataset.language === prefs.contentLanguage) &&
        inRange(card.dataset.price, price) &&
        inRange(card.dataset.days, length);
      card.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });

    document.getElementById("emptyTasks")?.classList.toggle("show", visibleCount === 0);
    const hint = document.getElementById("taskResultHint");
    if (hint) hint.textContent = `${visibleCount} ${visibleCount === 1 ? "Hatch" : "Hatches"}`;

    // A loosened filter can reveal foreign Hatches that were skipped earlier.
    hydrateTaskTranslations();
  }

  // Keeps a dual-thumb slider consistent: stops the thumbs crossing, repaints
  // the fill/labels, then re-runs the filters.
  function handleRangeInput(id, role) {
    const el = document.getElementById(id);
    if (!el) return;
    const minInput = el.querySelector('[data-role="min"]');
    const maxInput = el.querySelector('[data-role="max"]');
    const fill = el.querySelector('[data-role="fill"]');
    const lowLabel = el.querySelector('[data-role="low"]');
    const highLabel = el.querySelector('[data-role="high"]');
    const bound = { min: Number(minInput.min), max: Number(minInput.max) };
    let lo = Number(minInput.value);
    let hi = Number(maxInput.value);
    if (lo > hi) {
      if (role === "min") { lo = hi; minInput.value = String(hi); }
      else { hi = lo; maxInput.value = String(lo); }
    }
    const span = bound.max - bound.min || 1;
    fill.style.left = `${((lo - bound.min) / span) * 100}%`;
    fill.style.right = `${100 - ((hi - bound.min) / span) * 100}%`;
    const format = el.dataset.format;
    lowLabel.textContent = C.formatRangeValue(format, lo);
    highLabel.textContent = C.formatRangeValue(format, hi);
    applyTaskFilters();
  }

  function resetTaskFilters() {
    const search = document.getElementById("taskSearch");
    if (search) search.value = "";
    const industry = document.getElementById("industryFilter");
    if (industry) industry.value = "";
    const sort = document.getElementById("sortFilter");
    if (sort) sort.value = "";
    document.querySelectorAll(".level-check:checked").forEach((el) => { el.checked = false; });
    ["priceRange", "lengthRange"].forEach((id) => {
      const el = document.getElementById(id);
      const minInput = el?.querySelector('[data-role="min"]');
      const maxInput = el?.querySelector('[data-role="max"]');
      if (minInput) { minInput.value = minInput.min; handleRangeInput(id, "min"); }
      if (maxInput) { maxInput.value = maxInput.max; handleRangeInput(id, "max"); }
    });
    applyTaskFilters();
  }

  // Same search/filter/sort shape as applyTaskFilters, over the Operator
  // directory grid instead of the Hatch grid.
  function applyOperatorFilters() {
    const query = (document.getElementById("operatorSearch")?.value || "").toLowerCase();
    const levels = [...document.querySelectorAll(".operator-level-check:checked")].map((el) => el.value);
    const industry = document.getElementById("operatorIndustryFilter")?.value || "";
    const sort = document.getElementById("operatorSortFilter")?.value || "";
    const grid = document.getElementById("operatorDirectoryGrid");
    if (!grid) return;
    const cards = [...grid.querySelectorAll(".operator-row-card")];

    cards.forEach((card, index) => {
      if (card.dataset.order === undefined) card.dataset.order = String(index);
    });

    // Rating/completed/on-time/recommended sort high-to-low (best first);
    // level sorts low-to-high (L1 before L3), matching the Hatch level sort.
    // "Recommended" (the default, empty sort value) ranks by the blended
    // match score stamped on each card by operatorMatchScore().
    const sortKey = { rating: "rating", completed: "completed", ontime: "ontime", level: "levelNum" }[sort] || "score";
    const descending = sort !== "level";
    const sortValue = (card) => Number(card.dataset[sortKey]);
    const ordered = [...cards].sort((a, b) => {
      const diff = descending ? sortValue(b) - sortValue(a) : sortValue(a) - sortValue(b);
      return diff || Number(a.dataset.order) - Number(b.dataset.order);
    });
    ordered.forEach((card) => grid.appendChild(card));

    let visibleCount = 0;
    cards.forEach((card) => {
      const isVisible =
        (!query || card.dataset.search.toLowerCase().includes(query)) &&
        (!levels.length || levels.includes(card.dataset.level)) &&
        (!industry || card.dataset.industryList.split("|").includes(industry));
      card.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });

    document.getElementById("emptyOperators")?.classList.toggle("show", visibleCount === 0);
    const hint = document.getElementById("operatorResultHint");
    if (hint) hint.textContent = `${visibleCount} ${visibleCount === 1 ? "Operator" : "Operators"}`;
  }

  function resetOperatorFilters() {
    const search = document.getElementById("operatorSearch");
    if (search) search.value = "";
    const industry = document.getElementById("operatorIndustryFilter");
    if (industry) industry.value = "";
    const sort = document.getElementById("operatorSortFilter");
    if (sort) sort.value = "";
    document.querySelectorAll(".operator-level-check:checked").forEach((el) => { el.checked = false; });
    applyOperatorFilters();
  }

  // Login-gated compose entry point for the Operator directory: the row card's
  // quick "Message" button and the expanded profile modal both funnel here. A
  // logged-out visitor is sent to auth first (mirroring submitReviewedHatch's
  // pending-action pattern) instead of hitting a doomed 401.
  function messageOperator(operatorId) {
    if (!isLoggedIn() || !backendToken()) {
      localStorage.setItem("hatchPendingMessageTo", operatorId);
      setRoute("auth");
      return;
    }
    openNewMessage(operatorId, "", "");
  }

  // ── Clients directory ────────────────────────────────────────────────────
  // Mirror of the Operator directory helpers above, keyed off the client-*
  // element ids/classes rendered by findClientsPage. The card visual classes
  // are shared with the Operator grid (operator-row-card), so only the interactive
  // hooks differ.
  function applyClientFilters() {
    const query = (document.getElementById("clientSearch")?.value || "").toLowerCase();
    const types = [...document.querySelectorAll(".client-type-check:checked")].map((el) => el.value);
    const industry = document.getElementById("clientIndustryFilter")?.value || "";
    const sort = document.getElementById("clientSortFilter")?.value || "";
    const grid = document.getElementById("clientDirectoryGrid");
    if (!grid) return;
    const cards = [...grid.querySelectorAll(".operator-row-card")];

    cards.forEach((card, index) => {
      if (card.dataset.order === undefined) card.dataset.order = String(index);
    });

    // All client sorts run high-to-low (best first); "Recommended" (the empty
    // default) ranks by the blended match score stamped on each card.
    const sortKey = { rating: "rating", posted: "posted", hire: "hire" }[sort] || "score";
    const sortValue = (card) => Number(card.dataset[sortKey]);
    const ordered = [...cards].sort((a, b) => {
      const diff = sortValue(b) - sortValue(a);
      return diff || Number(a.dataset.order) - Number(b.dataset.order);
    });
    ordered.forEach((card) => grid.appendChild(card));

    let visibleCount = 0;
    cards.forEach((card) => {
      const isVisible =
        (!query || card.dataset.search.toLowerCase().includes(query)) &&
        (!types.length || types.includes(card.dataset.type)) &&
        (!industry || card.dataset.industryList.split("|").includes(industry));
      card.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });

    document.getElementById("emptyClients")?.classList.toggle("show", visibleCount === 0);
    const hint = document.getElementById("clientResultHint");
    if (hint) hint.textContent = `${visibleCount} ${visibleCount === 1 ? "client" : "clients"}`;
  }

  function resetClientFilters() {
    const search = document.getElementById("clientSearch");
    if (search) search.value = "";
    const industry = document.getElementById("clientIndustryFilter");
    if (industry) industry.value = "";
    const sort = document.getElementById("clientSortFilter");
    if (sort) sort.value = "";
    document.querySelectorAll(".client-type-check:checked").forEach((el) => { el.checked = false; });
    applyClientFilters();
  }

  function messageClient(clientId) {
    if (!isLoggedIn() || !backendToken()) {
      localStorage.setItem("hatchPendingMessageTo", clientId);
      setRoute("auth");
      return;
    }
    openNewMessage(clientId, "", "");
  }

  function openClientProfile(clientId) {
    const client = clients.find((item) => item.id === clientId);
    if (client) openModal(C.clientDetail(client));
  }

  // No task context to match against when an Operator browses clients (that
  // matching runs the other direction), so the recommended row just falls
  // back to top-rated. Kept as a seam mirroring operatorRecommendationContext.
  function clientRecommendationContext() {
    return {};
  }

  async function saveMission(taskId, status) {
    if (!isLoggedIn()) {
      localStorage.setItem("hatchPendingMission", JSON.stringify({ taskId, status }));
      setRoute("auth");
      return;
    }
    const task = findAnyTask(taskId);
    if (!task) return;
    if (C.statusInfo(task.status).label === "Hatched") return;

    // Applying to a Hatch (Incubating) claims it on the backend when possible so
    // the deliverable the Operator submits later actually reaches the poster. If
    // the task has no backendId (seed tasks) or the server is unreachable, the
    // mission is still saved locally and the demo flow keeps working.
    let backendId = task.backendId || null;
    let backendState = task.backendState || null;
    const applying = status === "Incubating" || status === "Accepted";
    if (applying && backendId && backendToken()) {
      const result = await backendFetch(`/api/hatches/${encodeURIComponent(backendId)}/claim`, { method: "POST" });
      if (result?.ok && result.hatch) {
        backendState = result.hatch.state || "claimed";
      } else if (result?.hatch?.state) {
        // Already claimed (e.g. re-applying) — keep the reported state.
        backendState = result.hatch.state;
      }
    }

    saveListItem(
      missionsKey(),
      { ...task, status, backendId, backendState, updatedAt: new Date().toISOString() },
      "id"
    );
    updateTaskCardState(taskId, status);
    const feedback = document.getElementById("taskFeedback");
    if (feedback) {
      feedback.textContent = applying ? "Hatch added to your Operator Hatches." : "Hatch saved to your profile.";
      feedback.classList.add("show");
    }
  }

  function completePendingMission() {
    const pending = readJson("hatchPendingMission", null);
    if (!pending?.taskId) return false;
    const task = findAnyTask(pending.taskId);
    localStorage.removeItem("hatchPendingMission");
    if (!task) return false;
    if (C.statusInfo(task.status).label === "Hatched") return false;
    const status = pending.status || "Saved";
    saveListItem(missionsKey(), { ...task, status, updatedAt: new Date().toISOString() }, "id");
    localStorage.setItem(
      "hatchProfileNotice",
      status === "Incubating" || status === "Accepted"
        ? "Hatch added to your Operator Hatches."
        : "Hatch saved to your profile."
    );
    setRoute("profile");
    return true;
  }

  function updateTaskCardState(taskId, status) {
    document.querySelectorAll(`[data-task-id="${taskId}"]`).forEach((card) => {
      card.classList.add(status === "Incubating" || status === "Accepted" ? "mission-accepted" : "mission-saved");
      const saveButton = card.querySelector(".save-action");
      const applyButton = card.querySelector(".apply-action");
      if (saveButton) saveButton.textContent = "Saved";
      if (applyButton && (status === "Incubating" || status === "Accepted")) {
        applyButton.textContent = "Incubating";
        applyButton.disabled = true;
      }
    });
  }

  function syncMissionCardStates() {
    getMissions().forEach((mission) => {
      if (mission.id) updateTaskCardState(mission.id, mission.status);
    });
  }

  function removeMission(identifier) {
    const missions = getMissions().filter((mission) => mission.id !== identifier && encodeURIComponent(mission.title) !== identifier);
    localStorage.setItem(missionsKey(), JSON.stringify(missions));
    render();
  }

  // --- Work submission (Operator) and review (poster) ---------------------
  // The Operator describes the deliverable, optionally attaching files and
  // links, and submits it for the poster to review. Submissions are sent to
  // the backend when the mission was claimed there (so the poster is notified
  // and can approve/reject from any session); a local copy is always kept so
  // the flow works offline and for seed tasks with no backend row.

  function findMission(missionId) {
    return getMissions().find((mission) => mission.id === missionId);
  }

  function openSubmitWork(missionId) {
    const mission = findMission(missionId);
    if (!mission) return;
    localStorage.removeItem("hatchSubmissionDraftFiles");
    openModal(C.submitWorkModal(mission));
  }

  async function handleSubmissionFiles(event) {
    const input = event.target;
    const chosen = [...(input.files || [])];
    if (!chosen.length) return;

    const oversized = chosen.filter((file) => file.size > MAX_DRAFT_FILE_BYTES);
    const accepted = chosen.filter((file) => file.size <= MAX_DRAFT_FILE_BYTES);
    if (oversized.length) {
      window.alert(`${oversized.length === 1 ? "This file is" : "These files are"} over 3 MB and can't be attached: ${oversized.map((file) => file.name).join(", ")}.`);
    }
    if (!accepted.length) {
      input.value = "";
      return;
    }

    let readFiles;
    try {
      readFiles = await Promise.all(accepted.map(async (file) => ({
        name: file.name,
        type: file.type || "file",
        size: file.size || 0,
        objectUrl: await readFileAsDataUrl(file),
      })));
    } catch (error) {
      window.alert(error.message || "One of those files could not be read. Please try again.");
      input.value = "";
      return;
    }

    const existing = readJson("hatchSubmissionDraftFiles", []);
    const nextFiles = [...existing, ...readFiles];
    if (!trySetLocalStorage("hatchSubmissionDraftFiles", nextFiles)) {
      window.alert("These files are too large to attach together. Try removing one or attaching fewer at a time.");
      input.value = "";
      return;
    }
    input.value = "";
    renderSubmissionAttachments();
  }

  function removeSubmissionFile(index) {
    const files = readJson("hatchSubmissionDraftFiles", []);
    files.splice(index, 1);
    localStorage.setItem("hatchSubmissionDraftFiles", JSON.stringify(files));
    renderSubmissionAttachments();
  }

  function renderSubmissionAttachments() {
    const host = document.getElementById("submissionAttachments");
    if (host) host.innerHTML = C.submissionAttachmentList(readJson("hatchSubmissionDraftFiles", []));
  }

  async function submitWork(event, missionId) {
    event.preventDefault();
    const mission = findMission(missionId);
    if (!mission) return;

    const messageEl = document.getElementById("submissionMessage");
    const linksEl = document.getElementById("submissionLinks");
    const message = (messageEl?.value || "").trim();
    if (!message) {
      messageEl?.focus();
      return;
    }

    const links = (linksEl?.value || "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((url) => ({ name: url, kind: "link", url }));
    const files = readJson("hatchSubmissionDraftFiles", []).map((file) => ({ ...file, kind: "file" }));
    const attachments = [...files, ...links];

    let delivered = false;
    if (mission.backendId && backendToken()) {
      const result = await backendFetch(`/api/hatches/${encodeURIComponent(mission.backendId)}/submit`, {
        method: "POST",
        body: { message, attachments },
      });
      if (result && result.status && result.status >= 400) {
        window.alert(result.error || "That work couldn't be submitted to the server. It's been saved locally.");
      } else if (result?.ok) {
        delivered = true;
      }
    }

    const submission = {
      message,
      attachments,
      status: "pending",
      submittedAt: new Date().toISOString(),
      delivered,
    };
    saveListItem(
      missionsKey(),
      { ...mission, status: "In review", submission, backendState: delivered ? "submitted" : mission.backendState, updatedAt: new Date().toISOString() },
      "id"
    );

    // Local bridge: mirror the submission onto the poster's copy of this Hatch
    // so the client can review it in the same browser even when the two sides
    // never met on the backend (self-posted demo Hatches, offline, seed tasks).
    // Posted/mission lists are per-account, so this only ever matches when the
    // same logged-in account is testing both sides of one Hatch.
    const posted = getPostedTasks();
    const postedIndex = posted.findIndex((task) => task.id === mission.id || (mission.backendId && task.backendId === mission.backendId));
    if (postedIndex !== -1) {
      posted[postedIndex] = { ...posted[postedIndex], status: "In review", submission, updatedAt: new Date().toISOString() };
      localStorage.setItem(postedTasksKey(), JSON.stringify(posted));
    }

    localStorage.removeItem("hatchSubmissionDraftFiles");
    localStorage.setItem("hatchProfileNotice", delivered
      ? "Work submitted. The client has been notified and can review it."
      : "Work submitted and saved to this Hatch.");
    closeModal();
    refreshConversations();
    render();
  }

  function openReviewWork(postedId) {
    const task = getPostedTasks().find((item) => item.id === postedId || encodeURIComponent(item.title) === postedId);
    if (!task) return;

    if (task.backendId && backendToken()) {
      backendFetch(`/api/hatches/${encodeURIComponent(task.backendId)}`).then((result) => {
        const remote = Array.isArray(result?.submissions)
          ? [...result.submissions].reverse().find((sub) => sub.status === "pending") || result.submissions[result.submissions.length - 1]
          : null;
        openModal(C.reviewWorkModal(task, remote || task.submission || null));
      });
      return;
    }
    openModal(C.reviewWorkModal(task, task.submission || null));
  }

  async function reviewWork(postedId, decision) {
    const task = getPostedTasks().find((item) => item.id === postedId || encodeURIComponent(item.title) === postedId);
    if (!task) return;
    const feedback = (document.getElementById("reviewFeedback")?.value || "").trim();
    const approving = decision === "approve";
    // Opt-in from the review modal: publish the finished project + delivered
    // result to Verified Results. Only meaningful on approval.
    const publishToVerified = approving && document.getElementById("reviewPublish")?.checked;

    if (task.backendId && backendToken()) {
      const result = await backendFetch(`/api/hatches/${encodeURIComponent(task.backendId)}/review`, {
        method: "POST",
        body: { decision: approving ? "approve" : "reject", feedback },
      });
      if (result && result.status && result.status >= 400) {
        window.alert(result.error || "That review couldn't be sent to the server.");
      }
    }

    const reviewedSubmission = task.submission
      ? { ...task.submission, status: approving ? "approved" : "rejected", feedback: feedback || task.submission.feedback, reviewedAt: new Date().toISOString() }
      : task.submission;
    saveListItem(
      postedTasksKey(),
      { ...task, status: approving ? "Hatched" : "Incubating", submission: reviewedSubmission, updatedAt: new Date().toISOString() },
      "id"
    );

    // Local bridge back to the Operator's copy so their mission reflects the
    // decision (Hatched on approve, back to Incubating to revise on reject).
    // Only matches when the same account is testing both sides (see submitWork).
    const missions = getMissions();
    const missionIndex = missions.findIndex((mission) => mission.id === task.id || (task.backendId && mission.backendId === task.backendId));
    if (missionIndex !== -1) {
      missions[missionIndex] = { ...missions[missionIndex], status: approving ? "Hatched" : "Incubating", submission: reviewedSubmission, updatedAt: new Date().toISOString() };
      localStorage.setItem(missionsKey(), JSON.stringify(missions));
    }

    if (publishToVerified) publishVerifiedResult(task, reviewedSubmission);

    localStorage.setItem("hatchProfileNotice", approving
      ? (publishToVerified
        ? "Submission approved. This Hatch is now Hatched and published to Verified Results."
        : "Submission approved. This Hatch is now Hatched.")
      : "Changes requested. The Operator has been asked to revise.");
    closeModal();
    refreshConversations();
    render();
  }

  // Reads the client-published completed Hatches shown on the Verified Results
  // page (newest first). Separate from the seeded completedHatches demo data.
  function getPublishedResults() {
    return readJson("hatchPublishedResults", []);
  }

  // Turns an approved task + its submission into a Verified Results record so
  // visitors can see the project and exactly what the Operator handed in. Shaped
  // to render through the same verifiedWorkCard / verifiedProjectDetail as the
  // seed data, but carries a plain operatorName (no seeded profile) plus the
  // delivered submission (message + attachments).
  function publishVerifiedResult(task, submission) {
    const account = getAccount();
    const operatorName = account.name || account.username || "Operator";
    const initials = operatorName
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "H";
    const level = task.level || "L1";
    const industry = task.industry || task.category || "General";
    const record = {
      id: `published-${task.backendId || task.id}`,
      title: task.title || "Completed Hatch",
      clientContext: task.business ? `Delivered for ${task.business}.` : (task.summary || task.objective || "Client-approved delivery."),
      objective: task.objective || task.summary || "Deliver a clear, usable result for the client.",
      scope: Array.isArray(task.scope) ? task.scope : [],
      deliverables: Array.isArray(task.deliverables) ? task.deliverables : [],
      industry,
      category: task.category || industry,
      level,
      amountEarned: task.budget || "—",
      completionTime: "on schedule",
      rating: "New",
      outcome: submission?.message || "Delivered work approved by the client.",
      completedAt: new Date().toISOString().slice(0, 10),
      verifiedBadges: ["Client accepted", "Completed"],
      operatorId: null,
      operatorName,
      operatorInitials: initials,
      operatorMeta: `${level} · ${industry}`,
      showProfile: true,
      showEarnings: Boolean(task.budget),
      showCompletionTime: true,
      published: true,
      submission: submission
        ? { message: submission.message || "", attachments: Array.isArray(submission.attachments) ? submission.attachments : [] }
        : null,
    };
    const list = getPublishedResults().filter((item) => item.id !== record.id);
    list.unshift(record);
    localStorage.setItem("hatchPublishedResults", JSON.stringify(list));
  }

  function deletePostedTask(identifier) {
    if (!window.confirm("Delete this posted Hatch?")) return;
    const target = getPostedTasks().find((task) => task.id === identifier || encodeURIComponent(task.title) === identifier);
    const postedTasks = getPostedTasks().filter((task) => task.id !== identifier && encodeURIComponent(task.title) !== identifier);
    localStorage.setItem(postedTasksKey(), JSON.stringify(postedTasks));
    // Clean up the backend mirror too: admins delete outright, owners cancel.
    if (target?.backendId && backendToken()) {
      const path = `/api/hatches/${encodeURIComponent(target.backendId)}`;
      backendFetch(path, { method: "DELETE" }).then((result) => {
        if (!result?.ok) backendFetch(`${path}/cancel`, { method: "POST" });
      });
    }
    render();
  }

  function getOperatorWizard() {
    return {
      step: localStorage.getItem("hatchOperatorStep") || "account",
      draft: readJson("hatchOperatorDraft", {}),
    };
  }

  function saveOperatorWizard(step, draft) {
    localStorage.setItem("hatchOperatorStep", step);
    localStorage.setItem("hatchOperatorDraft", JSON.stringify(draft));
  }

  function collectChoices(form, name) {
    const values = [...form.querySelectorAll(`[name="${name}"].selected`)].map((button) => button.value);
    const other = form.querySelector(`[name="${name}Other"]`)?.value.trim();
    if (other && !values.includes(other)) values.push(other);
    return values;
  }

  // Snapshots what the focus step currently holds so a re-render (e.g. after
  // attaching a resume) doesn't wipe the other fields the applicant filled in.
  function captureFocusDraft(baseDraft = getOperatorWizard().draft) {
    const form = document.querySelector(".operator-focus-form");
    if (!form) return baseDraft;
    return {
      ...baseDraft,
      industries: collectChoices(form, "industries"),
      exampleTasks: collectChoices(form, "exampleTasks"),
      linkedin: document.getElementById("operatorLinkedin")?.value.trim() ?? baseDraft.linkedin ?? "",
    };
  }

  // Rebuilds the wizard draft from a submitted application and jumps straight
  // into it — so "Update application" resumes with everything pre-filled
  // instead of starting a blank re-application.
  function updateOperatorApplication() {
    const account = getAccount();
    const application = getOperatorApplications()[0];
    const splitList = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    const draft = application
      ? {
        name: application.name || account.name || "",
        background: splitList(application.background),
        tools: splitList(application.tools),
        industries: splitList(application.industries),
        exampleTasks: splitList(application.exampleTasks),
        linkedin: application.linkedin || "",
        resumeName: application.resumeName || "",
        resumeData: application.resumeData || "",
      }
      : { name: account.name || "" };
    // Logged-in applicants already have an account, so skip that step.
    saveOperatorWizard(isLoggedIn() ? "about" : "account", draft);
    setRoute("operator");
  }

  function attachResume(event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    if (!file) return;
    // 2 MB keeps the data URL within the localStorage budget and the backend
    // body limit once base64-expanded.
    if (file.size > 2 * 1024 * 1024) {
      window.alert("That resume is over 2 MB. Please choose a smaller file.");
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const draft = captureFocusDraft();
      draft.resumeName = file.name;
      draft.resumeData = String(reader.result || "");
      saveOperatorWizard("focus", draft);
      render();
    };
    reader.onerror = () => window.alert("That resume could not be read. Please try another file.");
    reader.readAsDataURL(file);
  }

  function removeResume() {
    const draft = captureFocusDraft();
    delete draft.resumeName;
    delete draft.resumeData;
    saveOperatorWizard("focus", draft);
    render();
  }

  // Selecting "Become an Operator" makes you an Operator — so normalize any prior
  // role up to include Operator rather than dropping into an application flow.
  function operatorRoleFor(role) {
    if (!role) return "Operator";
    if (role.includes("Operator")) return role;
    if (role.includes("Client")) return "Client and Operator";
    return "Operator";
  }

  function operatorAccountStep(event) {
    event.preventDefault();
    const email = document.getElementById("operatorAuthEmail").value.trim();
    const password = document.getElementById("operatorAuthPassword").value;
    const existing = getAccount();
    const sameEmail = existing.email === email;
    const account = {
      username: sameEmail && existing.username ? existing.username : email.split("@")[0],
      name: sameEmail ? existing.name || "" : "",
      email,
      password,
      role: operatorRoleFor(sameEmail ? existing.role : ""),
      provider: "Email",
      joinedAt: sameEmail && existing.joinedAt ? existing.joinedAt : new Date().toISOString(),
    };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    localStorage.setItem("skillnestLoggedIn", "true");
    // Instant Operator — no application step. Land straight on the profile.
    finishOperatorWizard("profile");
  }

  function operatorGoogleSignup() {
    const existing = getAccount();
    const account = existing.email
      ? { ...existing, role: operatorRoleFor(existing.role), provider: "Google (simulated)" }
      : {
        username: "google_operator",
        name: "",
        email: "operator@gmail.com",
        password: "",
        role: "Operator",
        provider: "Google (simulated)",
        joinedAt: new Date().toISOString(),
      };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    localStorage.setItem("skillnestLoggedIn", "true");
    // Instant Operator — no application step. Land straight on the profile.
    finishOperatorWizard("profile");
  }

  function operatorContinueLoggedIn() {
    // Already signed in — just make sure the account carries the Operator role,
    // then land on the profile. No application step.
    const account = getAccount();
    const role = operatorRoleFor(account.role);
    if (role !== account.role) {
      localStorage.setItem("skillnestAccount", JSON.stringify({ ...account, role }));
    }
    finishOperatorWizard("profile");
  }

  function operatorStepNext(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const draft = {
      ...getOperatorWizard().draft,
      name: document.getElementById("operatorName")?.value.trim() || "",
      background: collectChoices(form, "background"),
      tools: collectChoices(form, "tools"),
    };
    saveOperatorWizard("focus", draft);
    render();
  }

  function operatorStepBack(event) {
    const form = event.target.closest("form");
    const { step, draft } = getOperatorWizard();
    if (step === "focus") {
      saveOperatorWizard("about", {
        ...draft,
        industries: collectChoices(form, "industries"),
        exampleTasks: collectChoices(form, "exampleTasks"),
        linkedin: document.getElementById("operatorLinkedin")?.value.trim() ?? draft.linkedin ?? "",
      });
    } else {
      saveOperatorWizard("account", {
        ...draft,
        name: document.getElementById("operatorName")?.value.trim() || draft.name || "",
        background: collectChoices(form, "background"),
        tools: collectChoices(form, "tools"),
      });
    }
    render();
  }

  function submitOperator(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const account = getAccount();
    const { draft } = getOperatorWizard();
    const application = {
      id: `operator-${Date.now()}`,
      name: draft.name || account.name || account.username || "",
      email: account.email || "",
      background: (draft.background || []).join(", "),
      tools: (draft.tools || []).join(", "),
      industries: collectChoices(form, "industries").join(", "),
      exampleTasks: collectChoices(form, "exampleTasks").join(", "),
      linkedin: document.getElementById("operatorLinkedin")?.value.trim() || draft.linkedin || "",
      resumeName: draft.resumeName || "",
      resumeData: draft.resumeData || "",
      status: "Submitted",
      submittedAt: new Date().toISOString(),
    };
    if (draft.name && !account.name) {
      localStorage.setItem("skillnestAccount", JSON.stringify({ ...account, name: draft.name }));
    }
    // One current application per person (the backend enforces the same), so an
    // update replaces the stored row rather than stacking a new one. Carry the
    // backend id over so refreshes keep tracking the same server record.
    const previous = getOperatorApplications()[0];
    if (previous?.backendId) application.backendId = previous.backendId;
    localStorage.setItem("skillnestOperatorApplications", JSON.stringify([application]));
    // Mirror to the backend queue so the admin can approve or reject it.
    if (backendToken()) {
      backendFetch("/api/hatcher-applications", { method: "POST", body: application }).then((result) => {
        if (!result?.ok) return;
        localStorage.setItem("skillnestOperatorApplications", JSON.stringify([{
          ...application,
          backendId: result.application.id,
          status: "Pending review",
        }]));
        render();
      });
    }
    saveOperatorWizard("done", {});
    render();
  }

  // Pulls the reviewed status (approved/rejected + admin note) back into the
  // local application list shown on the profile.
  async function refreshApplicationStatus() {
    if (!backendToken()) return;
    const data = await backendFetch("/api/hatcher-applications");
    if (!data?.ok || !data.applications?.length) return;
    const local = getOperatorApplications();
    const statusLabel = { pending: "Pending review", approved: "Approved", rejected: "Not approved" };
    let changed = false;
    const next = local.map((application) => {
      const remote = data.applications.find((item) => item.id === application.backendId)
        || data.applications[0];
      const label = statusLabel[remote.status] || application.status;
      // Normalize every value we might store (the backend sends null for an
      // unset review note; we keep "") and prefer whatever the applicant
      // attached locally, falling back to the server copy.
      const reviewNote = remote.reviewNote || "";
      const linkedin = application.linkedin || remote.linkedin || "";
      const resumeName = application.resumeName || remote.resumeName || "";
      const resumeData = application.resumeData || remote.resumeData || "";
      // Compare against the SAME normalized values we would store, so a
      // null-vs-"" difference can't flip `changed` on every pass and spin
      // render() -> refresh -> render() forever.
      if ((application.backendId ?? null) !== (remote.id ?? null)
        || application.status !== label
        || (application.reviewNote || "") !== reviewNote
        || (application.linkedin || "") !== linkedin
        || (application.resumeName || "") !== resumeName) {
        changed = true;
        return { ...application, backendId: remote.id, status: label, reviewNote, linkedin, resumeName, resumeData };
      }
      return application;
    });
    if (changed) {
      localStorage.setItem("skillnestOperatorApplications", JSON.stringify(next));
      render();
    }
  }

  // ── Browse ─────────────────────────────────────────────────────────────────
  // Open Hatches from other accounts are public backend data, no auth needed.
  // Same cache-then-refresh pattern as the inbox below.

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
      render();
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
      if (changed) { render(); return; } // render() rebuilds a fresh button
    }
    // No change (or the backend was unreachable): stop the spinner in place so
    // the click never feels like it did nothing.
    if (btn) { btn.disabled = false; btn.classList.remove("is-refreshing"); }
    flashBrowseRefreshStatus(data?.ok ? "Up to date" : "Couldn't reach the server");
  }

  // ── Messaging ──────────────────────────────────────────────────────────────
  // Conversations live on the backend; a localStorage cache lets render()
  // stay synchronous. Refreshes re-render only when something actually
  // changed, so the refresh-inside-render cycle settles instead of looping.
  // The open thread lives in module state (it survives re-renders because
  // the JS context does; only the DOM is rebuilt).

  let messagingThread = { conversationId: null, conversation: null, messages: [], loading: false };
  let messagesFilter = "all";

  // null = never fetched for this session (show "loading"), [] = genuinely
  // no conversations — the distinction stops a fresh login from flashing
  // "No conversations yet" while the first fetch is in flight.
  function getConversations() {
    return readJson("hatchConversationsCache", null);
  }

  function getMessagesUnread() {
    return Number(localStorage.getItem("hatchMessagesUnreadCache") || 0);
  }

  function clearMessagingState() {
    messagingThread = { conversationId: null, conversation: null, messages: [], loading: false };
    messagesFilter = "all";
    localStorage.removeItem("hatchConversationsCache");
    localStorage.removeItem("hatchMessagesUnreadCache");
    localStorage.removeItem("hatchInboxCache"); // pre-messaging cache cleanup
  }

  // Updates the nav badge in place — a full render() would wipe whatever the
  // user is typing just to change a number.
  function updateNavMessagesBadge() {
    const badge = document.querySelector("[data-msg-badge]");
    if (!badge) return;
    const count = getMessagesUnread();
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
  }

  // Re-render, but keep the half-typed chat message and its focus alive
  // across the innerHTML swap.
  function rerenderPreservingCompose() {
    const input = document.getElementById("chatComposeInput");
    const value = input ? input.value : "";
    const hadFocus = document.activeElement === input;
    render();
    const next = document.getElementById("chatComposeInput");
    if (next && value) next.value = value;
    if (next && hadFocus) next.focus();
  }

  let conversationsRefreshInFlight = false;
  async function refreshConversations() {
    if (!backendToken() || conversationsRefreshInFlight) return;
    conversationsRefreshInFlight = true;
    const data = await backendFetch("/api/messages/conversations");
    conversationsRefreshInFlight = false;
    if (!data?.ok) return;
    localStorage.setItem("hatchMessagesUnreadCache", String(data.unreadCount || 0));
    updateNavMessagesBadge();
    const list = data.conversations || [];
    if (JSON.stringify(list) !== localStorage.getItem("hatchConversationsCache")) {
      // Participant avatars can make this payload large; if the quota-guarded
      // write fails, retry with avatars stripped so the list still renders.
      if (!trySetLocalStorage("hatchConversationsCache", list)) {
        trySetLocalStorage("hatchConversationsCache", list.map((conversation) => ({
          ...conversation,
          participants: (conversation.participants || []).map((p) => ({ ...p, avatar: "" })),
        })));
      }
      if (currentRoute() === "messages" || currentRoute() === "profile") rerenderPreservingCompose();
    }
  }

  async function refreshMessagesUnread() {
    if (!backendToken()) return;
    const data = await backendFetch("/api/messages/unread-count");
    if (!data?.ok) return;
    const next = String(data.unreadCount || 0);
    if (next !== localStorage.getItem("hatchMessagesUnreadCache")) {
      localStorage.setItem("hatchMessagesUnreadCache", next);
      updateNavMessagesBadge();
    }
  }

  async function openConversation(id) {
    id = Number(id);
    messagingThread = { conversationId: id, conversation: null, messages: [], loading: true };
    if (currentRoute() !== "messages") setRoute("messages");
    render();

    const data = await backendFetch(`/api/messages/conversations/${id}`);
    // Stale response: the user opened another thread (or closed the pane)
    // while this fetch was in flight — don't clobber the newer state.
    if (messagingThread.conversationId !== id) return;
    if (!data?.ok) {
      messagingThread = { conversationId: null, conversation: null, messages: [], loading: false };
      render();
      return;
    }
    messagingThread = {
      conversationId: id,
      conversation: data.conversation,
      messages: data.messages || [],
      loading: false,
    };
    render();

    if (data.conversation.unreadCount > 0) {
      await backendFetch(`/api/messages/conversations/${id}/read`, { method: "POST" });
      refreshConversations();
    }
  }

  function closeThread() {
    messagingThread = { conversationId: null, conversation: null, messages: [], loading: false };
    render();
  }

  function setMessagesFilter(filter) {
    messagesFilter = filter;
    render();
  }

  // Reloads the open thread; re-renders only when render-relevant content
  // changed. readAt is excluded from the comparison — it isn't rendered, and
  // the server stamping it (own open, or the counterpart reading) would
  // otherwise force a spurious re-render on every poll.
  let threadReloadInFlight = false;
  async function reloadActiveThread() {
    const id = messagingThread.conversationId;
    if (!id || threadReloadInFlight) return;
    threadReloadInFlight = true;
    const data = await backendFetch(`/api/messages/conversations/${id}`);
    threadReloadInFlight = false;
    if (!data?.ok || messagingThread.conversationId !== id) return;
    const fingerprint = (msgs) => JSON.stringify((msgs || []).map(({ readAt, ...rest }) => rest));
    const changed = fingerprint(data.messages) !== fingerprint(messagingThread.messages);
    messagingThread = { conversationId: id, conversation: data.conversation, messages: data.messages || [], loading: false };
    if (changed) {
      rerenderPreservingCompose();
      if (data.conversation.unreadCount > 0) {
        await backendFetch(`/api/messages/conversations/${id}/read`, { method: "POST" });
        refreshConversations();
      }
    }
  }

  async function sendChatMessage(event) {
    event.preventDefault();
    const input = document.getElementById("chatComposeInput");
    const text = (input?.value || "").trim();
    const id = messagingThread.conversationId;
    if (!text || !id) return;
    if (input) input.value = "";

    const result = await backendFetch(`/api/messages/conversations/${id}`, { method: "POST", body: { body: text } });
    if (!result?.ok) {
      const retry = document.getElementById("chatComposeInput");
      if (retry) retry.value = text;
      window.alert(result?.error || "That message couldn't be sent. Is the server running?");
      return;
    }
    await reloadActiveThread();
    refreshConversations();
  }

  function openNewMessage(to = "", hatchId = "", hatchTitle = "") {
    openModal(C.newMessageModal({ to, hatchId, hatchTitle }));
    window.setTimeout(() => (document.getElementById(to ? "newMessageBody" : "newMessageTo") || document.getElementById("newMessageBody"))?.focus(), 60);
  }

  // "Message <poster>" on a browse card's detail modal.
  function openNewMessageForTask(taskId) {
    const task = findAnyTask(taskId);
    if (!task?.backendId || !task.createdByUsername) return;
    closeModal();
    openNewMessage(task.createdByUsername, task.backendId, task.title || "");
  }

  // "Message client / Message Operator" on profile rows: the server resolves
  // the other party from the hatch, so no local knowledge of who claimed it
  // is needed.
  function openNewMessageForHatch(backendId) {
    const known = [...getPostedTasks(), ...getMissions()].find((item) => item.backendId === backendId);
    openNewMessage("", backendId, known?.title || "");
  }

  // ── New-message recipient typeahead ────────────────────────────────────────
  // The composer autocompletes against the operator + client directory. Each
  // person's id doubles as their messaging handle (same value the "Message X"
  // buttons already send), so picking one just fills the "To" field with it.
  function messageablePeople() {
    const seen = new Set();
    return [...operators, ...clients].filter((person) => {
      if (!person || !person.id || seen.has(person.id)) return false;
      seen.add(person.id);
      return true;
    });
  }

  // Rank matches: whole-name/handle prefix beats a word prefix beats a
  // substring beats a tool match, so the closest names surface first.
  function matchPeople(query, limit = 6) {
    const needle = String(query || "").trim().toLowerCase().replace(/^@+/, "");
    if (!needle) return [];
    const scored = [];
    for (const person of messageablePeople()) {
      const name = String(person.name || "").toLowerCase();
      const handle = String(person.id || "").toLowerCase();
      const tools = (person.tools || []).join(" ").toLowerCase();
      let score = 0;
      if (handle.startsWith(needle) || name.startsWith(needle)) score = 4;
      else if (name.split(/\s+/).some((word) => word.startsWith(needle))) score = 3;
      else if (name.includes(needle) || handle.includes(needle)) score = 2;
      else if (tools.includes(needle)) score = 1;
      if (score > 0) scored.push({ person, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || String(a.person.name).localeCompare(String(b.person.name)))
      .slice(0, limit)
      .map((entry) => entry.person);
  }

  let recipientMatches = [];
  let recipientActiveIndex = -1;

  function hideRecipientMenu() {
    const input = document.getElementById("newMessageTo");
    const menu = document.getElementById("newMessageSuggestions");
    if (menu) { menu.hidden = true; menu.innerHTML = ""; }
    if (input) input.setAttribute("aria-expanded", "false");
    recipientMatches = [];
    recipientActiveIndex = -1;
  }

  function onRecipientInput() {
    const input = document.getElementById("newMessageTo");
    const menu = document.getElementById("newMessageSuggestions");
    if (!input || !menu) return;
    const matches = matchPeople(input.value, 6);
    recipientMatches = matches;
    recipientActiveIndex = -1;
    if (!matches.length) { hideRecipientMenu(); return; }
    menu.innerHTML = C.messageSuggestionList(matches);
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function highlightRecipient(index) {
    const menu = document.getElementById("newMessageSuggestions");
    if (!menu) return;
    const options = [...menu.querySelectorAll(".mention-option")];
    options.forEach((el, i) => {
      const on = i === index;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
      if (on) el.scrollIntoView({ block: "nearest" });
    });
    recipientActiveIndex = index;
  }

  function onRecipientKeydown(event) {
    const menu = document.getElementById("newMessageSuggestions");
    const open = menu && !menu.hidden && recipientMatches.length;
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightRecipient((recipientActiveIndex + 1) % recipientMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightRecipient((recipientActiveIndex - 1 + recipientMatches.length) % recipientMatches.length);
    } else if (event.key === "Enter" && recipientActiveIndex >= 0) {
      event.preventDefault(); // choose the highlighted person instead of submitting
      pickMessageRecipient(recipientMatches[recipientActiveIndex].id);
    } else if (event.key === "Escape") {
      hideRecipientMenu();
    }
  }

  // Fires on blur; a row's cancelled mousedown keeps focus, so a click on a
  // suggestion runs pickMessageRecipient before this can hide the menu.
  function onRecipientBlur() {
    hideRecipientMenu();
  }

  function pickMessageRecipient(id) {
    const input = document.getElementById("newMessageTo");
    if (input) input.value = id;
    hideRecipientMenu();
    document.getElementById("newMessageBody")?.focus();
  }

  async function sendNewMessage(event) {
    event.preventDefault();
    const to = document.getElementById("newMessageTo")?.value.trim() || "";
    const hatchId = document.getElementById("newMessageHatchId")?.value.trim() || "";
    const body = document.getElementById("newMessageBody")?.value.trim() || "";
    if (!body || (!to && !hatchId)) return;

    const payload = { body };
    if (to) payload.to = to;
    if (hatchId) payload.hatchId = hatchId;
    const result = await backendFetch("/api/messages/start", { method: "POST", body: payload });
    if (!result?.ok) {
      window.alert(result?.error || "That message couldn't be sent. Is the server running?");
      return;
    }
    closeModal();
    refreshConversations();
    openConversation(result.conversation.id);
  }

  async function archiveConversation(id, archived) {
    const result = await backendFetch(`/api/messages/conversations/${Number(id)}/${archived ? "archive" : "unarchive"}`, { method: "POST" });
    if (!result?.ok) {
      window.alert(result?.error || "That change couldn't be saved. Is the server running?");
      return;
    }
    if (messagingThread.conversation && messagingThread.conversationId === Number(id)) {
      messagingThread.conversation.archived = archived;
    }
    await refreshConversations();
    render();
  }

  // Poll for new activity so the nav badge and an open thread stay fresh
  // without websockets. Cache comparisons keep quiet polls render-free.
  window.setInterval(() => {
    if (!isLoggedIn() || !backendToken()) return;
    refreshMessagesUnread();
    if (currentRoute() === "messages") {
      refreshConversations();
      reloadActiveThread();
    }
  }, 20000);

  // ── Profile dropdown (nav avatar menu) ─────────────────────────────────────
  // The menu is rendered closed on every page build; these handlers open and
  // close it in place. Outside clicks and Escape close it from the
  // document-level listeners registered once below.

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
            activeId: messagingThread.conversationId,
            conversation: messagingThread.conversation,
            messages: messagingThread.messages,
            loading: messagingThread.loading,
            filter: messagesFilter,
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
    applyTaskFilters,
    applyOperatorFilters,
    applyClientFilters,
    handleRangeInput,
    resetTaskFilters,
    resetOperatorFilters,
    resetClientFilters,
    messageOperator,
    messageClient,
    openClientProfile,
    closeModal,
    findAnyTask,
    openModal,
    clearMessagingState,
    completeLogin,
    completeSignup,
    addCustomChoice,
    deletePostedTask,
    logout,
    finishOperatorWizard,
    operatorAccountStep,
    operatorContinueLoggedIn,
    operatorGoogleSignup,
    operatorStepBack,
    operatorStepNext,
    updateOperatorApplication,
    attachResume,
    removeResume,
    openOperatorProfile,
    openTaskDetail,
    openVerifiedOperatorProfile,
    openVerifiedProject,
    quickTestLogin,
    removeMission,
    openSubmitWork,
    handleSubmissionFiles,
    removeSubmissionFile,
    submitWork,
    openReviewWork,
    reviewWork,
    removeCustomChoice,
    render,
    openConversation,
    closeThread,
    setMessagesFilter,
    sendChatMessage,
    openNewMessage,
    openNewMessageForTask,
    openNewMessageForHatch,
    sendNewMessage,
    onRecipientInput,
    onRecipientKeydown,
    onRecipientBlur,
    pickMessageRecipient,
    archiveConversation,
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
    refreshBrowse,
    previewSiteStatsBanner,
    saveMission,
    shareVerifiedWork,
    showOperatorTab,
    socialLogin,
    submitOperator,
    testDeepSeekConnection,
    toggleChoice,
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
