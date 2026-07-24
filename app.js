window.SkillNestApp = (() => {
  const { tasks, operators, completedHatches, hatcherProfiles } = window.SkillNestData;
  const C = window.SkillNestComponents;
  const Pages = window.SkillNestPages;
  let voiceRecognition = null;
  let isVoiceListening = false;
  let isVoicePaused = false;
  let voiceHadTranscript = false;
  let voiceSessionText = "";
  let assistantTurnInFlight = false;
  const fileObjectUrls = new Map();

  function currentRoute() {
    return window.location.hash.replace("#", "") || "home";
  }

  function setRoute(route) {
    window.location.hash = route;
  }

  function applyDarkModePreference() {
    const isDark = localStorage.getItem("hatchDarkMode") === "true";
    document.documentElement.classList.toggle("dark-mode", isDark);
  }

  function toggleDarkMode() {
    const isDark = !document.documentElement.classList.contains("dark-mode");
    document.documentElement.classList.toggle("dark-mode", isDark);
    localStorage.setItem("hatchDarkMode", String(isDark));

    // Update the two bits of markup that depend on the theme in place, instead
    // of a full render(), so the switch element survives and its CSS slide
    // animation actually plays (a re-render would swap in a fresh element
    // already at its final position, killing the transition).
    document.querySelectorAll(".theme-switch").forEach((el) => {
      el.setAttribute("aria-checked", String(isDark));
      el.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    });
    document.querySelectorAll(".brand-logo").forEach((img) => {
      img.src = `assets/hatchlogo${isDark ? "-dark" : ""}.png?v=2`;
    });
  }

  // ── Language ───────────────────────────────────────────────────────────────

  function toggleLanguageMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById("languageMenu");
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    document.getElementById("languageButton")?.setAttribute("aria-expanded", String(open));
  }

  function closeLanguageMenu() {
    const menu = document.getElementById("languageMenu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      document.getElementById("languageButton")?.setAttribute("aria-expanded", "false");
    }
  }

  // "Browse" nav dropdown — same open/close mechanics as the language menu.
  function toggleBrowseMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById("navBrowseMenu");
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    document.getElementById("navBrowseButton")?.setAttribute("aria-expanded", String(open));
  }

  function closeBrowseMenu() {
    const menu = document.getElementById("navBrowseMenu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      document.getElementById("navBrowseButton")?.setAttribute("aria-expanded", "false");
    }
  }

  function chooseLanguage(code) {
    closeLanguageMenu();
    if (window.HatchI18n?.getLang() === code) return;
    window.HatchI18n?.setLang(code);
    render();
  }

  // First-visit language gate. Separate from HatchI18n's own "hatchLang"
  // storage key: setLang() only writes that key when the choice differs from
  // the current in-memory default, so picking English (already the default)
  // would never persist and the gate would reappear every visit. This flag
  // records that the visitor was asked at all, regardless of what — or
  // whether — they picked.
  const LANGUAGE_GATE_SEEN_KEY = "hatchLangGateSeen";

  function markLanguageGateSeen() {
    try {
      localStorage.setItem(LANGUAGE_GATE_SEEN_KEY, "true");
    } catch {
      /* private browsing — gate may reappear next visit */
    }
  }

  function showLanguageGate() {
    let seen;
    try {
      seen = localStorage.getItem(LANGUAGE_GATE_SEEN_KEY) === "true";
    } catch {
      seen = false;
    }
    if (seen) return;
    openModal(C.languageGateModal());
  }

  function chooseInitialLanguage(code) {
    markLanguageGateSeen();
    window.HatchI18n?.setLang(code);
    closeModal();
    render();
  }

  function dismissLanguageGate() {
    markLanguageGateSeen();
    closeModal();
  }

  // Content-language preferences live in one place (HatchI18n) and are mirrored
  // onto the account so they survive a backend account refresh. The browse
  // sidebar and the settings page both drive these same two setters, which is
  // what keeps the filter and the account setting from drifting apart.
  function persistContentPrefs(prefs) {
    const account = getAccount();
    if (!account.username) return;
    localStorage.setItem("skillnestAccount", JSON.stringify({
      ...account,
      contentLanguage: prefs.contentLanguage,
      foreignHatches: prefs.foreignHatches,
    }));
  }

  function setContentLanguage(code) {
    const prefs = window.HatchI18n?.setPrefs({ contentLanguage: code });
    if (!prefs) return;
    persistContentPrefs(prefs);
    render();
  }

  function setForeignHatchHandling(mode) {
    const prefs = window.HatchI18n?.setPrefs({ foreignHatches: mode });
    if (!prefs) return;
    persistContentPrefs(prefs);
    render();
  }

  // Restore saved preferences onto a freshly-loaded account (new browser, or a
  // backend session that just replaced the local copy).
  function syncContentPrefsFromAccount() {
    const account = getAccount();
    if (!account.contentLanguage && !account.foreignHatches) return;
    window.HatchI18n?.setPrefs({
      ...(account.contentLanguage ? { contentLanguage: account.contentLanguage } : {}),
      ...(account.foreignHatches ? { foreignHatches: account.foreignHatches } : {}),
    });
  }

  // Cards whose translation wasn't cached at render time render in their
  // original language with data-needs-translation, then get swapped in place
  // once the API answers. Repainting one card at a time avoids a full render()
  // that would fight with an open filter or a scrolled grid.
  function hydrateTaskTranslations() {
    const cards = [...document.querySelectorAll(".task-card[data-needs-translation]")];
    if (!cards.length) return;
    const target = window.HatchI18n?.getPrefs().contentLanguage;
    if (!target || !window.HatchTranslate) return;

    for (const card of cards) {
      // Never pay for a translation the reader can't see. Filtered-out cards
      // keep their marker and get picked up by the next hydration pass if a
      // filter change brings them back into view.
      if (card.hidden) continue;
      const task = findAnyTask(card.dataset.taskId);
      if (!task) continue;
      card.removeAttribute("data-needs-translation");
      window.HatchTranslate.translate(task, target).then((translation) => {
        if (!translation) {
          // Translation unavailable (offline, no API key, provider error). Keep
          // the original text and downgrade the "Translating…" badge to the
          // plain language badge, so the card still tells the reader what
          // language it is in rather than silently looking untranslatable.
          const live = document.querySelector(`.task-card[data-task-id="${CSS.escape(task.id)}"]`);
          const badge = live?.querySelector(".task-language-badge.pending");
          if (badge) {
            badge.outerHTML = C.languageBadge({ source: card.dataset.language, translated: false, pending: false });
            const fresh = live.querySelector(".task-language-badge");
            if (fresh) window.HatchI18n?.apply(fresh);
          }
          return;
        }
        const live = document.querySelector(`.task-card[data-task-id="${CSS.escape(task.id)}"]`);
        if (!live) return;
        const wasHidden = live.hidden;
        const order = live.dataset.order;
        live.outerHTML = C.taskCard(task, live.dataset.interactive === "1");
        const fresh = document.querySelector(`.task-card[data-task-id="${CSS.escape(task.id)}"]`);
        if (fresh) {
          fresh.hidden = wasHidden;
          if (order !== undefined) fresh.dataset.order = order;
          window.HatchI18n?.apply(fresh);
        }
      });
    }
  }

  // Expand a translated card to show the source text underneath.
  function toggleTaskOriginal(event) {
    const card = event.currentTarget.closest(".task-card");
    const original = card?.querySelector(".task-original");
    if (!original) return;
    const showing = original.hidden;
    original.hidden = !showing;
    const toggle = event.currentTarget.querySelector(".task-language-toggle");
    if (toggle) toggle.textContent = window.HatchI18n?.t(showing ? "Hide original" : "View original") || (showing ? "Hide original" : "View original");
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  // ── Backend client ─────────────────────────────────────────────────────────
  // The sync backend (hatchApi.js) holds accounts, hatcher applications, and
  // inboxes in SQLite. localStorage stays as the offline fallback: every call
  // here degrades to null so callers can keep the local behavior when the
  // server is down or the account never got a backend session.

  function backendUrl(path) {
    if (window.location.protocol === "file:") return `http://127.0.0.1:8132${path}`;
    return path;
  }

  function backendToken() {
    return localStorage.getItem("hatchAuthToken") || "";
  }

  async function backendFetch(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = backendToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetch(backendUrl(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, ...data };
    } catch {
      return null; // backend unreachable — callers fall back to localStorage
    }
  }

  // Stores a backend login: token plus the server's view of the account
  // (which carries isAdmin and the server-assigned role). Message caches are
  // per-account, so they reset whenever a session is (re)established.
  function storeBackendSession(data, localExtras = {}) {
    if (!data?.ok || !data.token) return false;
    clearMessagingState();
    localStorage.setItem("hatchAuthToken", data.token);
    const current = readJson("skillnestAccount", {});
    localStorage.setItem("skillnestAccount", JSON.stringify({ ...current, ...localExtras, ...data.account }));
    return true;
  }

  // Backend signup requires 6+ char passwords; older local demo accounts may
  // have shorter ones, so pad deterministically to keep login reproducible.
  function backendPassword(password = "") {
    return password.length >= 6 ? password : `${password}#hatch-local`;
  }

  // Refreshes the account from the server (role changes, admin flag) and
  // re-renders when anything user-visible changed.
  async function refreshBackendAccount() {
    if (!backendToken()) return;
    const data = await backendFetch("/api/auth/me");
    if (data?.status === 401) {
      localStorage.removeItem("hatchAuthToken");
      return;
    }
    if (!data?.ok || !data.account) return;
    const current = readJson("skillnestAccount", {});
    const merged = { ...current, ...data.account };
    if (JSON.stringify(merged) !== JSON.stringify(current)) {
      localStorage.setItem("skillnestAccount", JSON.stringify(merged));
      render();
    }
  }

  function getAccount() {
    const account = readJson("skillnestAccount", {});
    if (account.role === "AI Builder") return { ...account, role: "Hatcher" };
    if (account.role === "Client and AI Builder") return { ...account, role: "Client and Hatcher" };
    return account;
  }

  // Posted Hatches and missions are per-account data, but they used to be
  // stored under one shared key regardless of who was logged in — so on a
  // browser with two local accounts (e.g. an admin and the quick-test login),
  // posting or applying as one account showed up under the other too. Keys
  // are now suffixed with the active account's identity; scopedKey() falls
  // back to the bare key when logged out (nothing account-specific to scope).
  function accountScopeId() {
    const account = getAccount();
    return String(account.username || account.email || "").trim().toLowerCase();
  }

  function scopedKey(base) {
    const scope = accountScopeId();
    return scope ? `${base}::${scope}` : base;
  }

  // One-time migration: the first account to load the app after this change
  // inherits whatever was in the old shared key, then the shared key is
  // removed so no other account can also inherit it later.
  function migrateLegacyKey(base) {
    const scoped = scopedKey(base);
    if (scoped === base) return; // not logged in — nothing to scope yet
    if (localStorage.getItem(scoped) !== null) return; // already migrated for this account
    const legacy = localStorage.getItem(base);
    if (legacy === null) return;
    localStorage.setItem(scoped, legacy);
    localStorage.removeItem(base);
  }

  function postedTasksKey() {
    migrateLegacyKey("skillnestPostedTasks");
    return scopedKey("skillnestPostedTasks");
  }

  function missionsKey() {
    migrateLegacyKey("skillnestMissions");
    return scopedKey("skillnestMissions");
  }

  function getMissions() {
    return readJson(missionsKey(), []);
  }

  function getPostedTasks() {
    return readJson(postedTasksKey(), []);
  }

  // A data: URL is self-contained and durable (survives reload, can be sent
  // to the backend) — pass those through untouched. Only legacy blob:-URL
  // entries (from before files were read as data URLs) need re-mapping
  // through the session-scoped Map, and only for as long as that Map still
  // holds them; once the tab reloads, those blob: URLs are dead and get
  // correctly stripped so the UI shows "unavailable" instead of a broken link.
  function hydrateSessionFiles(files = []) {
    return files.map((file) => {
      if (String(file.objectUrl || "").startsWith("data:")) return file;
      const key = file.sessionId || `${file.name || "file"}-${file.size || 0}`;
      const { objectUrl, ...metadata } = file;
      return fileObjectUrls.has(key) ? { ...metadata, objectUrl: fileObjectUrls.get(key) } : metadata;
    });
  }

  function marketplaceTasks() {
    const posted = getPostedTasks().map((task) => {
      const industry = task.industry || task.category || "General";
      const category = task.category || industry;
      const rawObjective = task.objective || task.description || task.summary || "";
      const genericObjective = /ready for a hatcher to review|clear hatch brief/i.test(rawObjective);
      const fallbackObjective = C.generateTaskBrief(`${task.title || ""} ${industry} ${category}`, task.files || []).summary || "Create a clear, usable result for the client.";
      return {
        ...task,
        business: task.business || task.businessType || industry || "Client",
        objective: genericObjective ? fallbackObjective : rawObjective || fallbackObjective,
        description: genericObjective ? fallbackObjective : task.description || rawObjective || fallbackObjective,
        category,
        industry,
        level: task.level || task.suggestedLevel || "L1",
        budget: task.budget || task.suggestedBudget || "Flexible",
        timeline: task.timeline || task.deadline || task.estimatedCompletion || "Flexible",
        estimatedCompletion: task.estimatedCompletion || task.timeline || task.deadline || "Flexible",
        status: task.status || "New Hatch",
        deliverables: Array.isArray(task.deliverables) && task.deliverables.length ? task.deliverables : ["Review the Hatch brief", "Deliver the agreed outcome"],
        scope: Array.isArray(task.scope) ? task.scope : [],
        missingInfo: Array.isArray(task.missingInfo) ? task.missingInfo : [],
        files: Array.isArray(task.files) ? hydrateSessionFiles(task.files) : [],
        references: Array.isArray(task.references) ? task.references : [],
      };
    });
    const postedIds = new Set(posted.map((task) => task.id));
    const removedSeeds = new Set(readJson("hatchRemovedSeedTasks", []));
    return [...posted, ...tasks.filter((task) => !postedIds.has(task.id) && !removedSeeds.has(task.id))];
  }

  // Open Hatches posted by *other* accounts only ever reach this browser via
  // the backend — locally-posted tasks are scoped per account (see
  // scopedKey()), so nothing in localStorage can show them. This is a cached
  // read; refreshOpenHatches() below keeps the cache current.
  function getRemoteOpenHatches() {
    return readJson("hatchOpenHatchesCache", []);
  }

  function normalizeRemoteHatch(hatch) {
    return {
      id: hatch.id,
      backendId: hatch.id,
      title: hatch.title,
      business: hatch.business || "Client",
      objective: hatch.objective || hatch.description || "Create a clear, usable result for the client.",
      description: hatch.description || hatch.objective || "",
      budget: hatch.budget || "Flexible",
      deadline: hatch.deadline || hatch.timeline || "Flexible",
      timeline: hatch.timeline || hatch.deadline || "Flexible",
      estimatedCompletion: hatch.estimatedCompletion || hatch.timeline || "Flexible",
      industry: hatch.industry || "General",
      category: hatch.category || hatch.industry || "General",
      level: hatch.level || "L1",
      status: hatch.status || "New Hatch",
      deliverables: Array.isArray(hatch.deliverables) && hatch.deliverables.length ? hatch.deliverables : ["Review the Hatch brief", "Deliver the agreed outcome"],
      scope: Array.isArray(hatch.scope) ? hatch.scope : [],
      references: Array.isArray(hatch.references) ? hatch.references : [],
      missingInfo: Array.isArray(hatch.missingInfo) ? hatch.missingInfo : [],
      files: Array.isArray(hatch.files) ? hatch.files : [],
      createdById: hatch.createdBy?.id ?? null,
      createdByUsername: hatch.createdBy?.username || "",
    };
  }

  // Browse should only surface work someone else posted — a client shouldn't
  // find (and be able to "Apply to") their own Hatch in the marketplace.
  function browsableTasks() {
    const account = getAccount();
    const ownIds = new Set(getPostedTasks().map((task) => task.id));
    const knownBackendIds = new Set(marketplaceTasks().map((task) => task.backendId).filter(Boolean));
    const remote = getRemoteOpenHatches()
      .filter((hatch) => !(hatch.createdBy?.id && account.id && hatch.createdBy.id === account.id))
      .filter((hatch) => !(hatch.createdBy?.username && hatch.createdBy.username === account.username))
      .filter((hatch) => !knownBackendIds.has(hatch.id))
      .map(normalizeRemoteHatch);
    return [...marketplaceTasks().filter((task) => !ownIds.has(task.id)), ...remote];
  }

  function getOperatorApplications() {
    return readJson("skillnestOperatorApplications", []);
  }

  function isLoggedIn() {
    const account = getAccount();
    return localStorage.getItem("skillnestLoggedIn") === "true" && Boolean(account.username && account.name && account.email);
  }

  // localStorage has a hard quota (~5-10MB, shared across this whole app).
  // Now that attached files carry real base64 content instead of a tiny
  // blob-URL pointer, a write can legitimately fail — catch that instead of
  // letting a QuotaExceededError abort the caller mid-flow.
  function trySetLocalStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function saveListItem(key, item, matchKey = "title") {
    const list = readJson(key, []);
    const index = list.findIndex((existing) => existing[matchKey] === item[matchKey]);
    if (index >= 0) list[index] = { ...list[index], ...item };
    else list.unshift(item);
    return trySetLocalStorage(key, list);
  }

  function saveDraftTask() {
    const prompt = document.getElementById("taskPrompt");
    if (prompt) localStorage.setItem("skillnestDraftTask", prompt.value.trim());
  }

  function getGeneratedBrief() {
    const brief = readJson("skillnestGeneratedBrief", null);
    // Defend every "confidence < 40 = invalid" check against a brief that was
    // stored on a 0-1 scale (older build, or a model reply mid-conversation):
    // normalize to 0-100 on read so a resumed conversation can't be misread as
    // invalid_input. Idempotent for values already on the 0-100 scale.
    if (brief && brief.confidence != null) {
      brief.confidence = normalizeConfidence(brief.confidence, brief.isValidProject ? 72 : 0);
    }
    return brief;
  }

  // What to personalize the Hatcher recommendations around: the industry of
  // whatever project the visitor is currently working on, falling back to
  // their most recently posted Hatch. Empty when neither exists — the
  // recommendation algorithm still ranks by quality, just without a match boost.
  function hatcherRecommendationContext() {
    const brief = getGeneratedBrief();
    if (brief?.industry && brief.industry !== "General business") return { industry: brief.industry };
    const [latestPosted] = getPostedTasks();
    if (latestPosted?.industry) return { industry: latestPosted.industry };
    return {};
  }

  function getAssistantMessages() {
    return readJson("hatchAssistantMessages", []);
  }

  function saveAssistantMessages(messages) {
    localStorage.setItem("hatchAssistantMessages", JSON.stringify(messages));
  }

  // Splits one assistant reply into multiple chat bubbles by sentence, so a
  // combined "acknowledgment + question" reply reads like separate texts
  // instead of one dense paragraph.
  function splitAssistantText(text = "") {
    const trimmed = String(text || "").trim();
    if (!trimmed) return [];
    const sentences = trimmed.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
    if (!sentences) return [trimmed];
    return sentences.map((sentence) => sentence.trim()).filter(Boolean);
  }

  function assistantMessageEntries(text) {
    return splitAssistantText(text).map((chunk) => ({ role: "assistant", text: chunk }));
  }

  // The full text of the most recent assistant turn. Since one reply is split
  // into several sentence bubbles, the LAST bubble alone is a poor fingerprint
  // for duplicate detection — a verbatim repeat of a multi-sentence reply only
  // matches when compared whole. So join all consecutive trailing assistant
  // bubbles back into one string.
  function lastAssistantTurnText(messages = []) {
    const trailing = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") trailing.unshift(messages[i].text || "");
      else break;
    }
    return trailing.join(" ").trim();
  }

  // ── Assistant "thinking" + real-time typing ────────────────────────────────
  // The thinking flag drives the animated dots bubble while a turn is in flight.
  // The typing watermark (hatchTypedCount) records how many messages have already
  // been revealed, so only newly-arrived assistant bubbles type out — a re-render
  // for any other reason leaves settled messages fully shown.

  function setAssistantThinking(on) {
    localStorage.setItem("hatchAssistantThinking", on ? "true" : "false");
  }

  // Call when a brand-new conversation starts so its first reply types in.
  function resetAssistantTyping() {
    localStorage.setItem("hatchTypedCount", "0");
    localStorage.setItem("hatchAssistantThinking", "false");
  }

  let typingTimers = [];
  function clearTypingTimers() {
    typingTimers.forEach((id) => window.clearTimeout(id));
    typingTimers = [];
  }

  function typingDelayFor(text) {
    // Keep long replies snappy; short ones get a touch more character.
    return text.length > 220 ? 6 : text.length > 90 ? 11 : 18;
  }

  // Reveals any assistant bubbles past the watermark one character at a time.
  // Runs after render(); no-ops when nothing new arrived.
  function animateAssistantTyping() {
    if (currentRoute() !== "task-review") return;
    const thread = document.getElementById("assistantThread");
    if (!thread) return;
    const messages = getAssistantMessages();
    if (!messages.length) {
      localStorage.setItem("hatchTypedCount", "0");
      return;
    }
    const typedCount = Number(localStorage.getItem("hatchTypedCount") || 0);
    if (messages.length <= typedCount) return; // nothing new to reveal

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const articles = [...thread.querySelectorAll(".assistant-message")];
    clearTypingTimers();

    const queue = [];
    articles.forEach((article, index) => {
      if (index < typedCount) return; // already revealed on a prior render
      const paragraph = article.querySelector("p");
      if (!paragraph) return;
      // Only assistant bubbles type; the user's own message appears at once.
      if (article.classList.contains("assistant") && !article.classList.contains("user")) {
        queue.push({ paragraph, full: paragraph.textContent, article });
        if (!reduceMotion) {
          paragraph.textContent = "";
          article.classList.add("is-typing");
        }
      }
    });
    localStorage.setItem("hatchTypedCount", String(messages.length));
    if (reduceMotion || !queue.length) return;

    const revealNext = (i) => {
      if (i >= queue.length) return;
      const { paragraph, full, article } = queue[i];
      let pos = 0;
      const tick = () => {
        pos = Math.min(full.length, pos + 1);
        paragraph.textContent = full.slice(0, pos);
        scrollAssistantToLatest();
        if (pos < full.length) {
          typingTimers.push(window.setTimeout(tick, typingDelayFor(full)));
        } else {
          article.classList.remove("is-typing");
          typingTimers.push(window.setTimeout(() => revealNext(i + 1), 160));
        }
      };
      tick();
    };
    revealNext(0);
  }

  // ── Hero "I need help with…" typewriter ────────────────────────────────────
  // Cycles example asks in the hero (type, pause, delete), ending each loop on
  // a phrase that hands the mic to the visitor. Re-renders replace the DOM, so
  // timers are cleared and restarted from render().

  const heroTypewriterPhrases = [
    "a website for my bakery that takes orders",
    "automating my invoices with AI",
    "a chatbot that answers my customers",
    "turning messy spreadsheets into a dashboard",
    "a logo and brand kit for my startup",
    "your turn — type what you need below",
  ];
  let heroTypewriterTimer = null;

  function clearHeroTypewriter() {
    if (heroTypewriterTimer !== null) {
      window.clearTimeout(heroTypewriterTimer);
      heroTypewriterTimer = null;
    }
  }

  function startHeroTypewriter() {
    clearHeroTypewriter();
    const el = document.getElementById("heroTypewriter");
    if (!el) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      el.textContent = window.HatchI18n?.t(heroTypewriterPhrases[0]) || heroTypewriterPhrases[0];
      return;
    }

    let phraseIndex = 0;
    let pos = 0;
    let deleting = false;

    const tick = () => {
      // Bail out if a re-render swapped the DOM under us.
      if (!document.body.contains(el)) return;
      // Translate the example per active language. Slicing runs on the
      // translated string so the type/delete animation plays in Chinese too;
      // CJK chars are single UTF-16 units, so slice(0, pos) stays glyph-safe.
      const phrase = window.HatchI18n?.t(heroTypewriterPhrases[phraseIndex]) || heroTypewriterPhrases[phraseIndex];
      pos += deleting ? -1 : 1;
      el.textContent = phrase.slice(0, pos);

      let delay = deleting ? 26 : 46;
      if (!deleting && pos === phrase.length) {
        deleting = true;
        delay = 2100; // let the finished phrase breathe
      } else if (deleting && pos === 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % heroTypewriterPhrases.length;
        delay = 420;
      }
      heroTypewriterTimer = window.setTimeout(tick, delay);
    };
    tick();
  }

  function debugFlow(label, data = {}) {
    try {
      console.debug(`[Hatch flow] ${label}`, JSON.parse(JSON.stringify(data)));
    } catch {
      console.debug(`[Hatch flow] ${label}`, data);
    }
  }

  function sectionIdFromUpdateKey(key) {
    const normalized = String(key || "").toLowerCase().replace(/[\s-]+/g, "_");
    return {
      title: "title",
      project: "title",
      project_title: "title",
      business: "businessType",
      business_type: "businessType",
      client_context: "businessType",
      product: "businessType",
      product_type: "businessType",
      goal: "summary",
      objective: "summary",
      audience: "businessType",
      school_type: "businessType",
      target_audience: "businessType",
      deliverable: "deliverables",
      deliverables: "deliverables",
      timeline: "suggestedTimeline",
      deadline: "suggestedTimeline",
      budget: "suggestedBudget",
      industry: "industry",
      category: "industry",
      references: "references",
      reference: "references",
      files: "references",
      constraints: "constraints",
      constraint: "constraints",
      review: "review",
    }[normalized] || key || "general";
  }

  function firstRunMessage(brief) {
    if (!brief?.isValidProject || brief.stage === "invalid_input") {
      return brief.assistantMessage || "Tell me what you need done, who it is for, and what a good result would look like.";
    }
    if (brief.assistantMessage) return brief.assistantMessage;
    const title = brief.title || "this Hatch";
    const summary = brief.summary || `Shape ${title.toLowerCase()} into a clear Hatch.`;
    return `I think I’ve got the main idea: ${summary}\n\nI’ll handle the structure. ${nextSpecificQuestion(brief)}`;
  }

  function inferredCompletedSections(brief) {
    const completed = [];
    if (brief.title) completed.push("title");
    if (brief.businessType && brief.businessType !== "To be confirmed") completed.push("businessType");
    if (brief.summary) completed.push("summary");
    if (brief.deliverables?.length) completed.push("deliverables");
    if (brief.timelineKnown) completed.push("suggestedTimeline");
    if (brief.budgetKnown) completed.push("suggestedBudget");
    if (brief.industry && brief.industry !== "General business") completed.push("industry");
    if (brief.references?.length) completed.push("references");
    if (brief.constraints?.length) completed.push("constraints");
    return completed;
  }

  function initializeBuilderProgress(brief) {
    const ids = briefSectionIds();
    const completed = inferredCompletedSections(brief);
    const firstOpen = ids.findIndex((id) => !completed.includes(id));
    localStorage.setItem("hatchCompletedSections", JSON.stringify(completed));
    localStorage.setItem("hatchActiveSectionIndex", String(firstOpen === -1 ? ids.length : firstOpen));
  }

  function mergeInferredProgress(brief) {
    if (!brief?.ok || !brief.isValidProject) return;
    const ids = briefSectionIds();
    const completed = new Set([...completedSections(), ...inferredCompletedSections(brief)]);
    const firstOpen = ids.findIndex((id) => !completed.has(id));
    const currentIndex = Number(localStorage.getItem("hatchActiveSectionIndex") || 0);
    const currentId = ids[currentIndex];
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
    if (!currentId || completed.has(currentId) || brief.stage === "invalid_input") {
      setActiveSectionIndex(firstOpen === -1 ? ids.length : firstOpen);
    }
  }

  function nextSpecificQuestion(brief) {
    const missing = new Set(brief?.missingInfo || []);
    const text = `${brief?.title || ""} ${brief?.summary || ""} ${brief?.category || ""} ${brief?.taskType || ""}`.toLowerCase();
    if ((missing.has("cta") || missing.has("call to action") || missing.has("viewer action")) || /\b(video|promo|ad|reel|product)\b/.test(text)) {
      if (!/(sign up|download|buy|learn more|call to action|cta)/i.test(`${brief?.summary || ""} ${(brief?.constraints || []).join(" ")}`)) {
        return "The next thing I need is what the video should make viewers do: sign up, download, buy, or learn more?";
      }
    }
    if (!brief?.timelineKnown && (missing.has("timeline") || brief?.suggestedTimeline)) {
      return "The next useful thing is timing. When would you like this finished: this week, this month, or flexible?";
    }
    if (!brief?.budgetKnown && (missing.has("budget") || brief?.suggestedBudget)) {
      return "Now I need a rough budget. Would you prefer under $100, $100-300, $300-700, or flexible?";
    }
    if (!brief?.deliverables?.length) {
      return "For the output, do you want captions, visuals, a content calendar, or all of those?";
    }
    if (!brief?.industry || brief.industry === "General business") {
      return "What kind of business is this for? For example: cafe, salon, online store, or local service.";
    }
    return "Tell me the next detail you know, even if it is rough.";
  }

  function recoveredBriefFromAnswer(answer, previous = {}) {
    const generated = C.generateTaskBrief(answer, previous.files || []);
    if (!generated.ok) return null;
    const nextBrief = {
      ...previous,
      ...generated,
      ok: true,
      stage: "clarifying_missing_info",
      isValidProject: true,
      confidence: Math.max(Number(generated.confidence || 0), 58),
      sourceText: [previous.sourceText, answer].filter(Boolean).join("\n"),
      clarificationCount: Math.min((previous.clarificationCount || 0) + 1, 5),
    };
    if (nextBrief.category === "Content" && nextBrief.industry === "Restaurant") {
      nextBrief.title = "Instagram content for a cafe";
      nextBrief.summary = "Create Instagram content for a cafe so the business can post more consistently.";
      nextBrief.deliverables = ["Instagram post ideas", "Captions or copy", "Simple handoff notes"];
    }
    nextBrief.assistantMessage = `I can work with that. I’ve set this up as ${nextBrief.title.toLowerCase()}. ${nextSpecificQuestion(nextBrief)}`;
    nextBrief.nextQuestion = {
      key: !nextBrief.timelineKnown ? "timeline" : !nextBrief.budgetKnown ? "budget" : "deliverables",
      prompt: nextSpecificQuestion(nextBrief),
      suggestions: !nextBrief.timelineKnown ? ["This week", "This month", "Flexible"] : !nextBrief.budgetKnown ? ["Under $100", "$100-300", "$300-700", "Flexible"] : [],
      placeholder: "Type your answer",
    };
    return nextBrief;
  }

  function invalidGuidance(answer = "", key = "") {
    const clean = answer.toLowerCase().replace(/\binstragram\b/g, "instagram").replace(/\binsta\b/g, "instagram");
    if (key === "timeline") return "I’ll keep us on timing for a moment. You can say this week, next month, a date, or flexible.";
    if (key === "budget") return "I’ll keep us on budget for a moment. A rough range is enough, like under $100, $100-300, or flexible.";
    if (clean.includes("instagram") || clean.includes("insta")) {
      return "I understand Instagram is involved. Do you need content creation, account management, ads, or growth strategy?";
    }
    if (clean.includes("website")) {
      return "I understand this is about a website. Is it a new site, a redesign, or a small update?";
    }
    return "I’m not quite sure what the Hatch is yet. Tell me the task, who it is for, and what result you want.";
  }

  function invalidProjectBrief(sourceText = "") {
    return {
      ok: true,
      stage: "invalid_input",
      isValidProject: false,
      confidence: 10,
      title: "",
      businessType: "",
      industry: "",
      category: "General",
      suggestedLevel: "L1",
      suggestedBudget: "",
      suggestedTimeline: "",
      budgetKnown: false,
      timelineKnown: false,
      deliverables: [],
      knownRequirements: [],
      constraints: [],
      references: [],
      missingInfo: ["project request"],
      recommendedHatcherType: "",
      summary: "",
      assistantMessage: "I’m not quite sure what you want done yet. Tell me the task, who it is for, and what result you want.",
      nextQuestion: {
        key: "objective",
        prompt: "What are you trying to accomplish?",
        suggestions: ["Create social posts", "Build a simple website", "Organize customer data"],
        placeholder: "Describe the project in your own words",
      },
      readiness: "Needs More Context",
      sourceText,
      clarificationCount: 0,
    };
  }

  function processingProjectBrief(sourceText = "", files = []) {
    return {
      ok: true,
      stage: "understanding_project",
      isValidProject: true,
      confidence: 0,
      title: "",
      businessType: "",
      industry: "",
      category: "General",
      suggestedLevel: "L1",
      suggestedBudget: "",
      suggestedTimeline: "",
      budgetKnown: false,
      timelineKnown: false,
      deliverables: [],
      knownRequirements: [],
      constraints: [],
      references: [],
      missingInfo: ["Project", "Goal", "Business", "Deliverables"],
      recommendedHatcherType: "",
      summary: "",
      assistantMessage: "I’m reading through your project...",
      nextQuestion: { key: "none", prompt: "", suggestions: [], placeholder: "" },
      readiness: "Understanding Your Project",
      sourceText,
      files,
      isProcessing: true,
      clarificationCount: 0,
    };
  }

  function accountRoute(account = getAccount()) {
    if (account.role === "Operator" || account.role === "AI Builder" || account.role === "Hatcher") return "operator";
    if (account.role === "Client and operator" || account.role === "Client and AI Builder" || account.role === "Client and Hatcher") return "profile";
    return "create-hatch";
  }

  function setTaskError(message) {
    const error = document.getElementById("taskPromptError");
    if (!error) return;
    error.textContent = message;
    error.classList.add("show");
  }

  function clearTaskError() {
    document.getElementById("taskPromptError")?.classList.remove("show");
  }

  function startTaskFlow() {
    saveDraftTask();
    localStorage.removeItem("skillnestGeneratedBrief");
    localStorage.removeItem("hatchAssistantMessages");
    localStorage.removeItem("hatchActiveSectionIndex");
    localStorage.removeItem("hatchCompletedSections");
    localStorage.removeItem("hatchSectionMessages");
    localStorage.removeItem("hatchBriefEditKey");
    localStorage.removeItem("hatchAnsweredTurnIds");
    const prompt = document.getElementById("taskPrompt");
    const files = readJson("skillnestDraftFiles", []);
    const reviewButton = document.getElementById("reviewTaskButton");
    if (!prompt?.value.trim()) {
      setTaskError("Describe the Hatch first, even with one short sentence.");
      prompt?.focus();
      return;
    }

    clearTaskError();
    if (reviewButton) {
      reviewButton.textContent = "Understanding your project...";
      reviewButton.disabled = true;
    }

    const processingBrief = processingProjectBrief(prompt.value, files);
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(processingBrief));
    // Fresh conversation: clear the thread so only the thinking bubble shows,
    // and reset the typing watermark so the first reply types in.
    resetAssistantTyping();
    saveAssistantMessages([]);
    setRoute("task-review");

    window.setTimeout(async () => {
      const brief = await requestProjectIntake({
        mode: "organize",
        inputText: prompt.value,
        files,
      });
      if (!brief.ok) {
        localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(invalidProjectBrief(prompt.value)));
        setAssistantThinking(false);
        saveAssistantMessages(assistantMessageEntries("Tell me what you need done, who it is for, and what a good result would look like."));
        render();
        return;
      }

      initializeBuilderProgress(brief);
      const assistantText = firstRunMessage(brief);
      const nextBrief = attachNextTurn(applyFinalReviewState(brief, assistantText));
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
      setAssistantThinking(false);
      saveAssistantMessages(assistantMessageEntries(nextBrief.assistantMessage || assistantText));
      render();
    }, 420);
  }

  async function requestProjectIntake(payload) {
    const result = await window.HatchAIController.organize(payload);
    const rawBrief = result.data?.brief || result.payload;
    return normalizeProjectBrief(rawBrief, payload);
  }

  async function requestProjectAssistant(payload) {
    const result = await window.HatchAIController.continueConversation(payload);
    return result.data?.result || result.data?.brief || result.payload;
  }

  // DeepSeek is not told which scale to use for `confidence`, so it returns
  // either a 0-1 fraction (e.g. 0.6) or a 0-100 number (e.g. 60). The rest of
  // the app treats confidence as 0-100 (the "< 40 = invalid" gate, defaults of
  // 72/58/55). Without this, a valid reply scored 0.6 reads as "< 40" and the
  // whole brief flips to invalid_input — which strands the conversation on the
  // generic "What are you trying to accomplish?" question forever.
  function normalizeConfidence(value, fallback = 0) {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    const scaled = raw <= 1 ? raw * 100 : raw; // 0-1 fraction -> percentage
    return Math.round(Math.max(0, Math.min(100, scaled)));
  }

  function normalizeProjectBrief(brief, payload = {}) {
    const structuredBrief = brief.brief && typeof brief.brief === "object";
    const serverShaped = structuredBrief
      || brief.is_valid_project !== undefined
      || brief.valid_input !== undefined
      || brief.task_detected !== undefined
      || brief.task_type !== undefined
      || brief.assistant_message !== undefined
      || brief.missing_fields !== undefined
      || brief.missing_info !== undefined;
    if (serverShaped) {
      return normalizeIntakeResponse(brief, payload);
    }

    const fallback = payload.mode === "clarify"
      ? { ...(payload.brief || {}) }
      : C.generateTaskBrief(payload.inputText || brief.sourceText || "", payload.files || brief.files || []);

    return {
      ...fallback,
      ...brief,
      ok: brief.ok !== false,
      title: brief.title || fallback.title || "New project",
      deliverables: Array.isArray(brief.deliverables) ? brief.deliverables : fallback.deliverables || [],
      knownRequirements: Array.isArray(brief.knownRequirements) ? brief.knownRequirements : fallback.knownRequirements || [],
      constraints: Array.isArray(brief.constraints) ? brief.constraints : fallback.constraints || [],
      references: Array.isArray(brief.references) ? brief.references : fallback.references || [],
      missingInfo: Array.isArray(brief.missingInfo) ? brief.missingInfo : fallback.missingInfo || [],
      sourceText: brief.sourceText || fallback.sourceText || payload.inputText || "",
      files: Array.isArray(brief.files) ? brief.files : payload.files || fallback.files || [],
      clarificationCount: Number.isFinite(Number(brief.clarificationCount))
        ? Number(brief.clarificationCount)
        : fallback.clarificationCount || 0,
    };
  }

  function budgetOnlyWithoutProject(payload = {}, response = {}) {
    if (payload.mode === "clarify" || payload.brief?.isValidProject) return false;
    const text = String(payload.inputText || payload.answer || "").toLowerCase().trim();
    if (!text) return false;
    const hasMoney = /\$?\d+|under\s+\$?\d+|around\s+\d+|budget/.test(text);
    const hasTaskVerb = /\b(build|create|write|design|organize|research|draft|make|rewrite|automate|fix|update|prepare)\b/.test(text);
    const responseLooksBudgetOnly = /budget/i.test(response.specific_task || response.task_type || "");
    return hasMoney && !hasTaskVerb && responseLooksBudgetOnly;
  }

  function normalizeIntakeResponse(response, payload = {}) {
    const previous = payload.brief || {};
    const rawBrief = response.brief || {};
    const richUpdates = response.brief_updates || {};
    const responseIntent = String(response.intent || response.next_action || "").toUpperCase();
    const nonUpdatingIntents = new Set(["QUESTION", "HELP_REQUEST", "EXAMPLE_REQUEST", "CONFUSED", "GREETING", "SMALL_TALK", "INVALID"]);
    const broadAudienceAnswer = payload.mode === "clarify"
      && (payload.key === "audience" || payload.conversation_state?.expected_answer_type === "audience")
      && /\b(everybody|everyone|anyone|all people|general public)\b/i.test(payload.answer || "");
    const quickReplyAnswer = payload.quickReplyAnswer === true;
    const shouldUpdateBrief = broadAudienceAnswer || quickReplyAnswer || (response.should_update_brief !== false && !nonUpdatingIntents.has(responseIntent));
    const sectionUpdates = {
      ...(response.section_updates || {}),
      project: richUpdates.title || response.section_updates?.project,
      business: richUpdates.business || richUpdates.client_context || response.section_updates?.business,
      goal: richUpdates.objective || response.section_updates?.goal,
      deliverables: richUpdates.deliverables || response.section_updates?.deliverables,
      timeline: richUpdates.timeline || response.section_updates?.timeline,
      budget: richUpdates.budget || response.section_updates?.budget,
      industry: richUpdates.industry || response.section_updates?.industry,
      audience: broadAudienceAnswer ? "Broad audience, including the main public-facing groups" : richUpdates.audience || response.section_updates?.audience,
      references: richUpdates.references || response.section_updates?.references,
      constraints: richUpdates.constraints || response.section_updates?.constraints,
    };
    // The model writes budget/timeline straight into JSON fields here with no
    // normalization pass, unlike a single clarify-turn answer. Reject a
    // candidate that unambiguously belongs to the other field (most often a
    // timeline phrase like "this week" landing in budget) so it falls through
    // to the previous known-good value instead of overwriting it.
    const budgetCandidate = sectionUpdates.budget || rawBrief.budget || "";
    const timelineCandidate = sectionUpdates.timeline || rawBrief.deadline || "";
    const safeBudgetCandidate = looksLikeTimelineNotBudget(budgetCandidate) ? "" : budgetCandidate;
    const safeTimelineCandidate = looksLikeBudgetNotTimeline(timelineCandidate) ? "" : timelineCandidate;
    const sourceFallback = C.generateTaskBrief(payload.inputText || previous.sourceText || "", payload.files || previous.files || []);
    const hasProjectSignal = Boolean(
      response.task_detected === true
      || response.taskDetected === true
      || response.specific_task
      || response.task_type
      || richUpdates.title
      || richUpdates.objective
      || rawBrief.project_title
      || rawBrief.goal,
    );
    const taskDetected = response.task_detected === true || response.taskDetected === true || hasProjectSignal;
    // The model explicitly declaring the project valid is a stronger signal than
    // its confidence number, which it scores on an inconsistent scale (0-1, 0-10,
    // 0-100 all observed). When it's explicit, don't let a low/misscaled
    // confidence flip a real task to invalid_input and strand the conversation.
    const explicitlyValid = response.is_valid_project === true || response.isValidProject === true;
    const isValidProject = explicitlyValid
      || (response.valid_input === true && taskDetected)
      || (response.valid_input !== false && hasProjectSignal);
    const confidence = normalizeConfidence(response.confidence, isValidProject ? 72 : 0);
    if (budgetOnlyWithoutProject(payload, response)) {
      return {
        ...invalidProjectBrief(payload.inputText || ""),
        assistantMessage: "I can use that as a budget once I know the project. What do you need done?",
        confidence: 10,
      };
    }
    const stage = ["invalid_input", "understanding_project", "clarifying_missing_info", "ready_to_post"].includes(response.stage)
      ? response.stage
      : (isValidProject && (explicitlyValid || confidence >= 40) ? "clarifying_missing_info" : "invalid_input");

    // Low confidence alone no longer condemns a project the model called valid —
    // only genuine invalidity (or an explicit invalid_input stage) does.
    const lowConfidence = confidence < 40 && !explicitlyValid;
    if (!isValidProject || lowConfidence || stage === "invalid_input") {
      if (payload.mode === "clarify" && payload.answer) {
        const recovered = recoveredBriefFromAnswer(payload.answer, previous);
        if (recovered) return recovered;
      }
      if (payload.mode === "clarify" && previous?.isValidProject) {
        const contextual = contextualClarificationFallback(previous, payload.key, payload.answer || "");
        if (contextual) return contextual;
        return {
          ...previous,
          assistantMessage: payload.key === "timeline"
            ? "I’ll keep us on timeline for a moment. You can say something like this week, next month, or flexible."
            : payload.key === "budget"
              ? "I’ll keep us on budget for a moment. You can give a range, or say flexible."
              : invalidGuidance(payload.answer || "", payload.key || ""),
        };
      }
      const invalid = invalidProjectBrief(payload.inputText || previous.sourceText || "");
      return {
        ...invalid,
        assistantMessage: response.assistant_message || response.assistantMessage || invalid.assistantMessage,
        confidence,
        clarificationCount: previous.clarificationCount || 0,
      };
    }

    if (payload.mode === "clarify" && shouldUpdateBrief && response.normalized_value && response.section_id && response.should_mark_complete !== false) {
      const responseSectionId = sectionIdFromUpdateKey(response.section_id);
      const responseKey = assistantKeyForSection(responseSectionId);
      const normalized = normalizeUserAnswer(responseKey, response.normalized_value, previous);
      // normalizeBudgetAnswer/normalizeTimelineAnswer return "" when the model
      // labeled a cross-section value (e.g. "this week") as this section's
      // answer — in that case leave the field as it was rather than blanking
      // out a value the user already gave.
      const rejectedCrossSection = (normalized.key === "suggestedBudget" || normalized.key === "suggestedTimeline") && !normalized.value;
      const nextBrief = rejectedCrossSection
        ? { ...previous, updatedAt: new Date().toISOString() }
        : updateBriefObject({ ...previous, updatedAt: new Date().toISOString() }, normalized.key, normalized.value);
      if (response.expected_answer_type === "audience" || response.section_id === "audience" || payload.conversation_state?.expected_answer_type === "audience") {
        nextBrief.audience = normalizeUserAnswer("audience", response.normalized_value || payload.answer, previous).value;
        if (!nextBrief.businessType) nextBrief.businessType = nextBrief.audience;
        nextBrief.missingInfo = (nextBrief.missingInfo || []).filter((item) => !/audience|school type|target|primary audience/i.test(item));
      }
      nextBrief.assistantMessage = response.assistant_message || response.assistantMessage || normalizedAnswerMessage(responseSectionId, normalized.value);
      nextBrief.completedSectionId = responseSectionId;
      nextBrief.stage = response.ready_to_submit ? "ready_to_post" : "clarifying_missing_info";
      nextBrief.readiness = response.ready_to_submit ? "Ready to Post" : "Almost Ready";
      const nextQuestionText = response.next_question || response.nextQuestion || "";
      const quickReplies = Array.isArray(response.quick_replies)
        ? response.quick_replies.filter(Boolean)
        : Array.isArray(response.quickReplies)
        ? response.quickReplies.filter(Boolean)
        : [];
      if (nextQuestionText) {
        nextBrief.nextQuestion = {
          key: expectedTypeFromQuestion(nextQuestionText, response.next_section || response.active_section || "general"),
          prompt: nextQuestionText,
          suggestions: quickReplies,
          placeholder: "Reply naturally",
        };
        nextBrief.activeQuestion = nextQuestionText;
        nextBrief.activeSection = sectionForActiveQuestion(nextQuestionText, nextBrief.nextQuestion.key);
        nextBrief.expectedAnswerType = nextBrief.nextQuestion.key;
        nextBrief.assistantMessage = response.assistant_message || response.assistantMessage || normalizedAnswerMessage(responseSectionId, normalized.value, nextBrief.nextQuestion);
      }
      nextBrief.missingInfo = removeMissingInfoForSection(nextBrief.missingInfo || [], responseSectionId, response.expected_answer_type || response.section_id);
      return nextBrief;
    }

    const missingFields = Array.isArray(response.missing_info)
      ? response.missing_info.filter(Boolean)
      : Array.isArray(response.missingInfo)
      ? response.missingInfo.filter(Boolean)
      : Array.isArray(response.missing_fields) ? response.missing_fields.filter(Boolean) : [];
    const deliverables = Array.isArray(rawBrief.deliverables) ? rawBrief.deliverables.filter(Boolean) : [];
    const constraints = Array.isArray(rawBrief.constraints) ? rawBrief.constraints.filter(Boolean) : [];
    const references = Array.isArray(rawBrief.references)
      ? rawBrief.references.filter(Boolean)
      : [rawBrief.references].filter(Boolean);
      const nextQuestionText = response.next_question || "";
    const quickReplies = Array.isArray(response.quick_replies)
      ? response.quick_replies.filter(Boolean)
      : Array.isArray(response.quickReplies)
      ? response.quickReplies.filter(Boolean)
      : Array.isArray(response.quick_replies) ? response.quick_replies.filter(Boolean) : [];
    const fieldsUpdated = Array.isArray(response.fields_updated)
      ? response.fields_updated.filter(Boolean)
      : Array.isArray(response.fieldsUpdated)
      ? response.fieldsUpdated.filter(Boolean)
      : [];
    const understoodItems = Array.isArray(response.what_i_understood)
      ? response.what_i_understood.filter(Boolean)
      : Array.isArray(response.whatIUnderstood)
      ? response.whatIUnderstood.filter(Boolean)
      : [];
    const remainingUncertainties = Array.isArray(response.remaining_uncertainties)
      ? response.remaining_uncertainties.filter(Boolean)
      : Array.isArray(response.remainingUncertainties)
      ? response.remainingUncertainties.filter(Boolean)
      : [];
    const understandingSummary = response.understanding_summary && typeof response.understanding_summary === "object"
      ? response.understanding_summary
      : previous.understandingSummary || {};
    const qualityCheck = response.quality_check && typeof response.quality_check === "object"
      ? response.quality_check
      : previous.qualityCheck || {};
    const hatcherQuestions = Array.isArray(response.hatcher_questions)
      ? response.hatcher_questions.filter(Boolean).slice(0, 4)
      : previous.hatcherQuestions || [];
    const responseActiveSection = sectionIdFromUpdateKey(response.active_section || response.section_id || response.next_section || missingFields[0] || "general");
    const responseExpectedType = response.expected_answer_type
      || assistantKeyForSection(responseActiveSection)
      || assistantKeyForSection(sectionIdFromUpdateKey(missingFields[0] || ""));
    const aiReadiness = String(response.readiness || "").toLowerCase();
    const normalizedStage = stage === "ready_to_post" || aiReadiness === "ready_to_post"
      ? "ready_to_post"
      : (missingFields.length ? "clarifying_missing_info" : "understanding_project");
    const readiness = normalizedStage === "ready_to_post"
      ? "Ready to Post"
      : aiReadiness === "shaping"
        ? "Shaping the Hatch"
        : normalizedStage === "clarifying_missing_info"
        ? "Almost Ready"
        : "Understanding Your Project";

    const normalized = {
      ...previous,
      ok: true,
      stage: normalizedStage,
      isValidProject: true,
      confidence,
      title: shouldUpdateBrief ? sectionUpdates.project || rawBrief.project_title || response.specific_task || sourceFallback.title || previous.title || "Untitled Hatch" : previous.title,
      businessType: shouldUpdateBrief ? sectionUpdates.business || rawBrief.business_type || richUpdates.client_context || sourceFallback.businessType || previous.businessType || "" : previous.businessType,
      clientContext: shouldUpdateBrief ? richUpdates.client_context || response.client_context || previous.clientContext || "" : previous.clientContext,
      audience: shouldUpdateBrief ? sectionUpdates.audience || rawBrief.audience || previous.audience || "" : previous.audience,
      industry: shouldUpdateBrief ? sectionUpdates.industry || rawBrief.industry || sourceFallback.industry || previous.industry || rawBrief.business_type || "" : previous.industry,
      category: shouldUpdateBrief ? richUpdates.category || response.task_type || rawBrief.category || sourceFallback.category || previous.category || "General" : previous.category,
      suggestedLevel: shouldUpdateBrief ? richUpdates.recommended_hatcher_level || richUpdates.recommendedLevel || rawBrief.operator_level || sourceFallback.suggestedLevel || previous.suggestedLevel || "L1" : previous.suggestedLevel,
      suggestedBudget: shouldUpdateBrief ? safeBudgetCandidate || previous.suggestedBudget || "" : previous.suggestedBudget,
      suggestedTimeline: shouldUpdateBrief ? safeTimelineCandidate || previous.suggestedTimeline || "" : previous.suggestedTimeline,
      budgetKnown: shouldUpdateBrief ? Boolean(safeBudgetCandidate || previous.budgetKnown) : previous.budgetKnown,
      timelineKnown: shouldUpdateBrief ? Boolean(safeTimelineCandidate || previous.timelineKnown) : previous.timelineKnown,
      deliverables: shouldUpdateBrief ? Array.isArray(sectionUpdates.deliverables) && sectionUpdates.deliverables.length ? sectionUpdates.deliverables : deliverables.length ? deliverables : sourceFallback.deliverables || previous.deliverables || [] : previous.deliverables || [],
      scope: shouldUpdateBrief ? Array.isArray(richUpdates.scope) ? richUpdates.scope.filter(Boolean) : Array.isArray(rawBrief.scope) ? rawBrief.scope.filter(Boolean) : previous.scope || sourceFallback.scope || [] : previous.scope || [],
      knownRequirements: previous.knownRequirements || [],
      constraints: shouldUpdateBrief ? Array.isArray(sectionUpdates.constraints) && sectionUpdates.constraints.length ? sectionUpdates.constraints : constraints.length ? constraints : previous.constraints || [] : previous.constraints || [],
      references: shouldUpdateBrief ? sectionUpdates.references ? [sectionUpdates.references].flat().filter(Boolean) : references.length ? references : previous.references || [] : previous.references || [],
      missingInfo: missingFields,
      recommendedHatcherType: (richUpdates.recommended_hatcher_level || rawBrief.operator_level) ? `${richUpdates.recommended_hatcher_level || rawBrief.operator_level} Hatcher` : previous.recommendedHatcherType || "",
      summary: sectionUpdates.goal || rawBrief.goal || sourceFallback.summary || previous.summary || "",
      assistantMessage: response.assistant_message || response.assistantMessage || C.fallbackAssistantMessage(previous),
      fieldsUpdated,
      whatIUnderstood: understoodItems,
      remainingUncertainties,
      understandingSummary,
      qualityCheck,
      hatcherQuestions,
      activeSection: responseActiveSection,
      activeQuestion: response.nextQuestion || nextQuestionText || "",
      expectedAnswerType: responseExpectedType || "general",
      lastAssistantIntent: responseIntent || response.intent || response.next_action || "",
      nextQuestion: (response.nextQuestion || nextQuestionText) ? {
        key: responseExpectedType || missingFields[0] || "general",
        prompt: response.nextQuestion || nextQuestionText,
        suggestions: quickReplies,
        placeholder: "Type your answer",
      } : { key: "none", prompt: "", suggestions: [], placeholder: "" },
      readiness,
      sourceText: payload.inputText || rawBrief.sourceText || previous.sourceText || "",
      taskType: shouldUpdateBrief ? response.task_type || previous.taskType || "" : previous.taskType || "",
      specificTask: shouldUpdateBrief ? response.specific_task || previous.specificTask || "" : previous.specificTask || "",
      files: Array.isArray(rawBrief.files) ? rawBrief.files : payload.files || previous.files || [],
      clarificationCount: Math.min(Number(previous.clarificationCount || 0) + (payload.mode === "clarify" ? 1 : 0), 5),
    };

    if (sourceFallback.ok && sourceFallback.title?.toLowerCase().includes("instagram")) {
      normalized.title = sourceFallback.title;
      normalized.summary = sourceFallback.summary || normalized.summary;
      normalized.deliverables = sourceFallback.deliverables?.length ? sourceFallback.deliverables : normalized.deliverables;
      normalized.category = sourceFallback.category || normalized.category;
      normalized.businessType = sourceFallback.businessType || normalized.businessType;
      normalized.industry = sourceFallback.industry || normalized.industry;
      normalized.nextQuestion = normalized.nextQuestion?.key && normalized.nextQuestion.key !== "none" ? normalized.nextQuestion : sourceFallback.nextQuestion;
    }

    if (shouldUpdateBrief && payload.mode === "clarify" && payload.answer && (payload.key === "audience" || payload.conversation_state?.expected_answer_type === "audience") && !normalized.audience) {
      normalized.audience = normalizeUserAnswer("audience", payload.answer, previous).value;
      normalized.missingInfo = (normalized.missingInfo || []).filter((item) => !/audience|school type|target/i.test(item));
    }

    if (shouldUpdateBrief && payload.mode === "clarify" && payload.answer && payload.conversation_state?.expected_answer_type === "audience") {
      normalized.audience = normalized.audience || normalizeUserAnswer("audience", payload.answer, previous).value;
      normalized.missingInfo = (normalized.missingInfo || []).filter((item) => !/audience|school type|target|primary audience/i.test(item));
      if (!normalized.businessType && normalized.audience) normalized.businessType = normalized.audience;
    }

    if (shouldUpdateBrief && payload.mode === "clarify" && payload.sectionId && briefSectionIds().includes(payload.sectionId) && !questionLike(payload.answer || "") && response.next_action !== "answer_question") {
      const updatedSection = fieldsUpdated.map(sectionIdFromUpdateKey).find((sectionId) => briefSectionIds().includes(sectionId));
      const responseSection = sectionIdFromUpdateKey(response.section_id || response.active_section || "");
      normalized.completedSectionId = updatedSection || (briefSectionIds().includes(responseSection) ? responseSection : payload.sectionId);
    }

    if (shouldUpdateBrief && Array.isArray(response.completed_sections) && response.completed_sections.length) {
      const completed = response.completed_sections.map(sectionIdFromUpdateKey);
      localStorage.setItem("hatchCompletedSections", JSON.stringify([...new Set([...completedSections(), ...completed])]));
    }

    if (shouldUpdateBrief && fieldsUpdated.length) {
      const completedFromUpdates = fieldsUpdated
        .map(sectionIdFromUpdateKey)
        .filter((sectionId) => briefSectionIds().includes(sectionId));
      if (completedFromUpdates.length) {
        localStorage.setItem("hatchCompletedSections", JSON.stringify([...new Set([...completedSections(), ...completedFromUpdates])]));
      }
    }

    if (response.active_section) {
      const ids = briefSectionIds();
      const sectionId = sectionIdFromUpdateKey(response.active_section);
      const index = ids.indexOf(sectionId);
      if (index >= 0) setActiveSectionIndex(index);
    }

    return normalized;
  }

  function removeMissingInfo(brief, key) {
    return (brief.missingInfo || []).filter((item) => item !== key);
  }

  function briefKeyFromAssistantKey(key) {
    return {
      timeline: "suggestedTimeline",
      budget: "suggestedBudget",
      objective: "summary",
    }[key] || key;
  }

  function uncertainAnswer(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return [
      "i dont know",
      "i don t know",
      "i am not sure",
      "im not sure",
      "not sure",
      "no idea",
      "unsure",
      "idk",
      "up to you",
      "you decide",
    ].includes(clean);
  }

  function correctionIntent(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return clean.startsWith("no actually") || clean.startsWith("actually") || clean.startsWith("no wait") || clean.includes("i meant");
  }

  function recentTopicFromMessages(messages = []) {
    const assistantMessages = messages.filter((message) => message.role === "assistant").slice().reverse();
    for (const message of assistantMessages) {
      const text = String(message.text || "").toLowerCase();
      if (text.includes("timeline") || text.includes("timing") || text.includes("finished") || text.includes("this week") || text.includes("this month")) return "timeline";
      if (text.includes("budget") || text.includes("range") || text.includes("$")) return "budget";
      if (text.includes("deliverable") || text.includes("captions") || text.includes("visuals")) return "deliverables";
    }
    return "";
  }

  function sectionIdForAssistantKey(key = "") {
    return {
      timeline: "suggestedTimeline",
      budget: "suggestedBudget",
      deliverables: "deliverables",
    }[key] || key;
  }

  function questionLike(answer = "") {
    const clean = answer.toLowerCase().trim();
    return clean.endsWith("?") || /^(what|why|how|can|could|should|would|do|does|is|are|will)\b/.test(clean);
  }

  function normalizedQuestionText(text = "") {
    return String(text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Question scaffolding carries no meaning: "What is the name of your bakery?" and
  // "What is the style of your bakery?" share every word except the one that matters.
  // Comparing raw words rates those as the same question, so strip the scaffolding
  // and compare only the words that distinguish one question from another.
  const QUESTION_STOPWORDS = new Set([
    "what", "whats", "when", "where", "which", "who", "why", "how",
    "are", "was", "were", "you", "youre", "your", "yours", "the", "and", "but", "for",
    "can", "could", "would", "should", "will", "shall", "may", "might", "does", "did",
    "have", "has", "had", "tell", "share", "give", "got", "now", "thanks", "thank",
    "please", "this", "that", "these", "those", "any", "some", "let", "know", "about",
    "like", "with", "from", "into", "more", "much", "there", "here", "sure", "great",
    "perfect", "awesome", "okay", "yeah", "yes", "help", "need", "needs", "want",
    "wants", "looking", "look", "just", "also", "then", "than", "them", "they", "their",
  ]);

  function contentWords(text = "") {
    return new Set(
      normalizedQuestionText(text)
        .split(" ")
        .filter((word) => word.length > 2 && !QUESTION_STOPWORDS.has(word)),
    );
  }

  function contentOverlap(previousText = "", nextText = "") {
    const previousWords = contentWords(previousText);
    const nextWords = contentWords(nextText);
    if (!previousWords.size || !nextWords.size) return 0;
    const matches = [...nextWords].filter((word) => previousWords.has(word)).length;
    return matches / Math.max(previousWords.size, nextWords.size);
  }

  function isSameQuestion(previousQuestion = "", nextQuestion = "") {
    const previous = normalizedQuestionText(previousQuestion);
    const next = normalizedQuestionText(nextQuestion);
    if (!previous || !next) return false;
    if (previous === next) return true;
    return contentOverlap(previousQuestion, nextQuestion) >= 0.72;
  }

  function isDuplicateAssistantMessage(previousMessage = "", nextMessage = "") {
    const previous = normalizedQuestionText(previousMessage);
    const next = normalizedQuestionText(nextMessage);
    if (!previous || !next) return false;
    if (previous === next) return true;
    return contentOverlap(previousMessage, nextMessage) >= 0.78;
  }

  function answeredTurnIds() {
    return new Set(readJson("hatchAnsweredTurnIds", []));
  }

  function saveAnsweredTurnIds(ids) {
    localStorage.setItem("hatchAnsweredTurnIds", JSON.stringify([...ids]));
  }

  function makeTurnId() {
    return `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function currentTurnForState(brief = {}, state = {}) {
    const questionText = state.active_question || brief.activeQuestion || brief.nextQuestion?.prompt || "";
    const activeSection = state.active_section || sectionForActiveQuestion(questionText, state.expected_answer_type);
    const expectedAnswerType = state.expected_answer_type || expectedTypeFromQuestion(questionText, assistantKeyForSection(activeSection));
    const existing = brief.currentTurn || {};
    if (existing.questionText && isSameQuestion(existing.questionText, questionText)) {
      return {
        turnId: existing.turnId || makeTurnId(),
        questionText,
        activeSection: existing.activeSection || activeSection,
        expectedAnswerType: existing.expectedAnswerType || expectedAnswerType,
      };
    }
    return {
      turnId: makeTurnId(),
      questionText,
      activeSection,
      expectedAnswerType,
    };
  }

  function markTurnAnswered(turnId) {
    if (!turnId) return;
    const ids = answeredTurnIds();
    ids.add(turnId);
    saveAnsweredTurnIds(ids);
  }

  function attachNextTurn(brief = {}) {
    const questionText = brief.nextQuestion?.prompt || brief.activeQuestion || "";
    if (!questionText || brief.stage === "ready_to_post") {
      const { currentTurn, ...rest } = brief;
      return rest;
    }
    const activeSection = sectionForActiveQuestion(questionText, brief.nextQuestion?.key || brief.expectedAnswerType);
    const expectedAnswerType = expectedTypeFromQuestion(questionText, brief.nextQuestion?.key || assistantKeyForSection(activeSection));
    return {
      ...brief,
      activeQuestion: questionText,
      activeSection,
      expectedAnswerType,
      currentTurn: {
        turnId: makeTurnId(),
        questionText,
        activeSection,
        expectedAnswerType,
      },
    };
  }

  function removeMissingInfoForSection(missingInfo = [], sectionId = "", expectedType = "") {
    const section = sectionIdFromUpdateKey(sectionId);
    const type = String(expectedType || "").toLowerCase();
    const patterns = {
      businessType: /business|industry|client|context|audience|school type|target|product type|type of product/i,
      summary: /goal|objective|main message|key points?|highlight|focus|outcome|success/i,
      deliverables: /deliverable|output|scope|format|handoff/i,
      suggestedTimeline: /timeline|deadline|timing|finished|completion/i,
      suggestedBudget: /budget|price|cost|range/i,
      industry: /industry|business|category/i,
      references: /reference|file|material|source|example|link|photo|logo|menu|product list/i,
      constraints: /constraint|tone|style|avoid|requirement/i,
    };
    const pattern = patterns[section] || (type ? new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null);
    if (!pattern) return missingInfo;
    return missingInfo.filter((item) => !pattern.test(String(item || "")));
  }

  function resolveAnswerForActiveTurn(brief = {}, state = {}, answer = "", turn = {}) {
    const activeQuestion = turn.questionText || state.active_question || brief.activeQuestion || brief.nextQuestion?.prompt || "";
    const expectedType = turn.expectedAnswerType || state.expected_answer_type || expectedTypeFromQuestion(activeQuestion, "general");
    const sectionId = sectionForActiveQuestion(activeQuestion, expectedType);
    if (!briefSectionIds().includes(sectionId)) return null;
    const flexibleSection = ["suggestedTimeline", "suggestedBudget", "references", "constraints"].includes(sectionId);
    if (!answerLooksConcrete(answer) && !(flexibleSection && (uncertainAnswer(answer) || skipAnswer(answer)))) return null;

    let normalized = normalizeUserAnswer(sectionId, answer, {
      ...brief,
      activeQuestion,
      expectedAnswerType: expectedType,
    });
    let nextBrief = updateBriefObject({ ...brief, updatedAt: new Date().toISOString() }, normalized.key, normalized.value);

    if (expectedType === "audience" || /audience|who is this.*for|who is this video|students|parents/i.test(activeQuestion)) {
      normalized = { key: "audience", value: normalizeAudienceAnswer(answer) };
      nextBrief.audience = normalized.value;
      if (!nextBrief.businessType) nextBrief.businessType = normalized.value;
      nextBrief.missingInfo = removeMissingInfoForSection(nextBrief.missingInfo || [], "businessType", "audience");
    }

    if (expectedType === "product" || expectedType === "product_type" || /product type|type of product|what type of product/i.test(activeQuestion)) {
      normalized = { key: "businessType", value: normalizeProductTypeAnswer(answer) };
      nextBrief.businessType = normalized.value;
      nextBrief.clientContext = normalized.value;
      nextBrief.missingInfo = removeMissingInfoForSection(nextBrief.missingInfo || [], "businessType", "product_type");
    }

    if (expectedType === "business" || expectedType === "business_name" || expectedType === "app_name" || /name of your app|app name|business name|brand name|app or business/i.test(activeQuestion)) {
      const name = titleCaseShort(answer);
      normalized = { key: "clientContext", value: name };
      nextBrief.clientContext = name;
      nextBrief.knownRequirements = [...new Set([...(nextBrief.knownRequirements || []), `Business/app name: ${name}`])];
      nextBrief.missingInfo = (nextBrief.missingInfo || []).filter((item) => !/app name|business name|brand name|product name|name/i.test(item));
    }

    if (sectionId === "suggestedBudget") {
      nextBrief.suggestedBudget = normalizeBudgetAnswer(answer);
      nextBrief.budgetKnown = true;
      nextBrief.missingInfo = removeMissingInfoForSection(nextBrief.missingInfo || [], sectionId, "budget");
    }

    if (sectionId === "suggestedTimeline") {
      nextBrief.suggestedTimeline = normalizeTimelineAnswer(answer);
      nextBrief.timelineKnown = true;
      nextBrief.missingInfo = removeMissingInfoForSection(nextBrief.missingInfo || [], sectionId, "timeline");
    }

    if (sectionId === "references") {
      nextBrief.references = [normalizeReferenceAnswer(answer)].filter(Boolean);
      nextBrief.missingInfo = removeMissingInfoForSection(nextBrief.missingInfo || [], sectionId, "references");
    }

    nextBrief.missingInfo = removeMissingInfoForSection(nextBrief.missingInfo || [], sectionId, expectedType);
    return {
      answered: true,
      sectionId,
      expectedType,
      normalizedValue: normalized.value,
      brief: nextBrief,
      fieldsUpdated: [normalized.key || sectionId],
    };
  }

  function mergeResolvedAnswer(aiBrief = {}, resolution = null) {
    if (!resolution?.answered) return aiBrief;
    const merged = { ...aiBrief };
    if (resolution.sectionId === "businessType") {
      merged.businessType = aiBrief.businessType || resolution.brief.businessType;
      merged.clientContext = aiBrief.clientContext || resolution.brief.clientContext;
      merged.audience = aiBrief.audience || resolution.brief.audience;
    }
    if (resolution.sectionId === "suggestedBudget" && !merged.suggestedBudget) {
      merged.suggestedBudget = resolution.brief.suggestedBudget;
      merged.budgetKnown = true;
    }
    if (resolution.sectionId === "suggestedTimeline" && !merged.suggestedTimeline) {
      merged.suggestedTimeline = resolution.brief.suggestedTimeline;
      merged.timelineKnown = true;
    }
    if (resolution.sectionId === "references" && !(merged.references || []).length) {
      merged.references = resolution.brief.references || [];
    }
    merged.missingInfo = removeMissingInfoForSection(merged.missingInfo || [], resolution.sectionId, resolution.expectedType);
    merged.fieldsUpdated = [...new Set([...(merged.fieldsUpdated || []), ...(resolution.fieldsUpdated || [])])];
    merged.completedSectionId = merged.completedSectionId || resolution.sectionId;
    return merged;
  }

  function recoveredBriefAfterDuplicate(brief = {}, state = {}, answer = "", resolution = null) {
    const recovered = applyAnsweredQuestionLocally(brief, state, answer);
    if (recovered) return recovered;
    if (!resolution?.answered) return null;

    const nextBrief = {
      ...resolution.brief,
      ok: true,
      isValidProject: true,
      stage: "clarifying_missing_info",
      readiness: "Almost Ready",
      updatedAt: new Date().toISOString(),
    };
    const suggested = nextSpecificQuestion(nextBrief);
    nextBrief.nextQuestion = {
      key: expectedTypeFromQuestion(suggested, "general"),
      prompt: suggested,
      suggestions: [],
      placeholder: "Reply naturally",
    };
    nextBrief.activeQuestion = suggested;
    nextBrief.activeSection = sectionForActiveQuestion(suggested, nextBrief.nextQuestion.key);
    nextBrief.expectedAnswerType = nextBrief.nextQuestion.key;
    nextBrief.assistantMessage = normalizedAnswerMessage(resolution.sectionId, resolution.normalizedValue, nextBrief.nextQuestion);
    nextBrief.completedSectionId = resolution.sectionId;
    return nextBrief;
  }

  function answerLooksConcrete(answer = "") {
    const clean = normalizedAnswer(answer);
    if (!clean || clean.length < 2) return false;
    if (questionLike(answer)) return false;
    if (/^(not sure|idk|i don t know|maybe|help|examples?)$/.test(clean)) return false;
    return true;
  }

  function sectionForActiveQuestion(question = "", expectedType = "") {
    const text = normalizedQuestionText(question);
    if (expectedType === "audience" || /\b(who|audience|students|parents|community)\b/.test(text)) return "businessType";
    if (expectedType === "business" || expectedType === "business_name" || expectedType === "app_name" || /\b(name of your app|app name|business name|brand name|name of your business|app or business)\b/.test(text)) return "businessType";
    if (expectedType === "product" || expectedType === "product_type" || /\b(product type|type of product|what type of product|digital product|physical product)\b/.test(text)) return "businessType";
    if (expectedType === "budget" || /\b(budget|price|cost|\$)\b/.test(text)) return "suggestedBudget";
    if (expectedType === "timeline" || /\b(when|timeline|deadline|finished|completed)\b/.test(text)) return "suggestedTimeline";
    if (expectedType === "deliverables" || /\b(deliver|output|format|reel|video|hand over|hand back)\b/.test(text)) return "deliverables";
    if (expectedType === "references" || /\b(reference|file|example|material|photo|logo|link)\b/.test(text)) return "references";
    if (expectedType === "constraints" || /\b(tone|style|avoid|constraint)\b/.test(text)) return "constraints";
    if (expectedType === "goal" || /\b(main message|key message|key points|highlight|feature|focus|remember|convey|culture|spirit|goal|outcome)\b/.test(text)) return "summary";
    return sectionIdFromUpdateKey(expectedType || "summary");
  }

  function applyAnsweredQuestionLocally(brief = {}, state = {}, answer = "") {
    if (!brief?.ok || !answerLooksConcrete(answer)) return null;
    const sectionId = sectionForActiveQuestion(state.active_question, state.expected_answer_type);
    if (!briefSectionIds().includes(sectionId)) return null;

    const normalized = normalizeUserAnswer(sectionId, answer, {
      ...brief,
      activeQuestion: state.active_question,
    });
    const nextBrief = updateBriefObject({ ...brief, updatedAt: new Date().toISOString() }, sectionId, normalized.value);
    if (state.expected_answer_type === "audience" || /audience|who is this for|who is this video/i.test(state.active_question || "")) {
      nextBrief.audience = normalizeAudienceAnswer(answer);
      if (!nextBrief.businessType) nextBrief.businessType = nextBrief.audience;
      nextBrief.missingInfo = (nextBrief.missingInfo || []).filter((item) => !/audience|school type|target|primary audience/i.test(item));
    }
    if (state.expected_answer_type === "product" || state.expected_answer_type === "product_type" || /product type|type of product|what type of product/i.test(state.active_question || "")) {
      nextBrief.businessType = normalizeProductTypeAnswer(answer);
      nextBrief.clientContext = nextBrief.businessType;
      nextBrief.missingInfo = (nextBrief.missingInfo || []).filter((item) => !/product type|type of product|product context|business context/i.test(item));
    }
    if (state.expected_answer_type === "business" || state.expected_answer_type === "business_name" || state.expected_answer_type === "app_name" || /name of your app|app name|business name|brand name|app or business/i.test(state.active_question || "")) {
      const name = titleCaseShort(answer);
      nextBrief.businessType = nextBrief.businessType || name;
      nextBrief.clientContext = name;
      nextBrief.knownRequirements = [...new Set([...(nextBrief.knownRequirements || []), `Business/app name: ${name}`])];
      nextBrief.missingInfo = (nextBrief.missingInfo || []).filter((item) => !/app name|business name|brand name|product name|name/i.test(item));
    }
    if (sectionId === "summary") {
      const focus = cleanSentence(answer).replace(/\.$/, "");
      nextBrief.summary = brief.summary
        ? `${brief.summary.replace(/\.$/, "")}. Key message/focus: ${focus}.`
        : `Focus the Hatch on ${focus}.`;
      nextBrief.constraints = [...new Set([...(brief.constraints || []), `Key focus: ${focus}`])];
      nextBrief.missingInfo = (nextBrief.missingInfo || []).filter((item) => !/main message|key points?|highlight|culture|spirit|specific aspects|goal|objective/i.test(item));
    }

    const completed = new Set([...completedSections(), sectionId, ...inferredCompletedSections(nextBrief)]);
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
    const suggested = nextSpecificQuestion(nextBrief);
    nextBrief.nextQuestion = {
      key: expectedTypeFromQuestion(suggested, "general"),
      prompt: suggested,
      suggestions: [],
      placeholder: "Reply naturally",
    };
    nextBrief.activeQuestion = suggested;
    nextBrief.activeSection = sectionIdFromUpdateKey(nextBrief.nextQuestion.key);
    nextBrief.expectedAnswerType = nextBrief.nextQuestion.key;
    nextBrief.assistantMessage = normalizedAnswerMessage(sectionId, normalized.value, nextBrief.nextQuestion);
    return nextBrief;
  }

  function repeatsActiveQuestion(response = {}, payload = {}) {
    return isSameQuestion(
      payload.conversation_state?.active_question || payload.brief?.activeQuestion || "",
      response.next_question || response.nextQuestion || "",
    );
  }

  function adviceRequest(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return questionLike(answer)
      || clean.includes("makes sense")
      || clean.includes("what time")
      || clean.includes("what budget")
      || clean.includes("you recommend")
      || clean.includes("recommend")
      || clean.includes("suggest")
      || clean.includes("what should")
      || clean.includes("which one");
  }

  function adviceForSection(brief, key) {
    const category = brief?.category || "General";
    const level = brief?.suggestedLevel || "L1";
    if (key === "timeline") {
      const message = category === "Content"
        ? "For content work, this week makes sense if it’s just captions or a small batch. If you want a full calendar with visuals, this month is safer."
        : level === "L3" || level === "L4"
          ? "For this level of work, I’d usually give it one to two weeks so the Hatcher has room to test and refine it."
          : "For a simple Hatch, this week is reasonable. If you’re not in a rush, flexible gives Hatchers more room to do it well.";
      return {
        message: `${message} Which should I put down?`,
        question: {
          key: "timeline",
          prompt: "Which timeline should I use?",
          suggestions: ["This week", "This month", "Flexible"],
          placeholder: "Type a timeline",
        },
      };
    }
    if (key === "budget") {
      const message = level === "L1"
        ? "For an L1 Hatch, I’d start around $50-150. If you want more polish or several versions, $150-300 gives more room."
        : level === "L2"
          ? "For this kind of Hatch, $150-500 is a realistic range depending on how much detail you want."
          : "For a more technical Hatch, I’d expect at least $500 so the Hatcher can build and test it properly.";
      return {
        message: `${message} Which range should I use for now?`,
        question: {
          key: "budget",
          prompt: "Which budget range should I use?",
          suggestions: ["Under $100", "$100-300", "$300-700", "Flexible"],
          placeholder: "Type a budget",
        },
      };
    }
    if (key === "deliverables") {
      return {
        message: "For this Hatch, I’d include a first usable draft plus editable handoff notes. If it’s Instagram content, captions and a simple posting plan would be the clearest deliverables.",
        question: {
          key: "deliverables",
          prompt: "Should I include captions, visuals, a posting plan, or all three?",
          suggestions: ["Captions", "Visuals", "Posting plan", "All three"],
          placeholder: "Type deliverables",
        },
      };
    }
    return {
      message: "I can help decide. Tell me what part you’re unsure about, and I’ll suggest a practical option.",
      question: {
        key,
        prompt: "What part should I help you decide?",
        suggestions: [],
        placeholder: "Type your question",
      },
    };
  }

  function uncertaintyForSection(brief, key) {
    const advice = adviceForSection(brief, key);
    return {
      ...advice,
      message: `No worries — I can recommend one. ${advice.message}`,
    };
  }

  function normalizedAnswer(answer = "") {
    return String(answer || "").toLowerCase().replace(/[^\w\s$-]/g, " ").replace(/\s+/g, " ").trim();
  }

  function looksLikeNoise(answer = "") {
    const clean = normalizedAnswer(answer);
    if (!clean) return true;
    const words = clean.split(" ").filter(Boolean);
    const unique = new Set(words);
    if (clean.length < 3) return true;
    if (words.length >= 2 && unique.size === 1) return true;
    if (/^(.)\1{4,}$/.test(clean.replace(/\s/g, ""))) return true;
    if (!/[aeiou]/.test(clean) && clean.length > 6) return true;
    return /^[a-z]{5,}$/.test(clean) && unique.size === 1 && ![
      "cafe", "salon", "store", "shopify", "restaurant", "captions", "website", "flexible",
    ].includes(clean);
  }

  function validTimelineAnswer(answer = "") {
    const clean = normalizedAnswer(answer);
    if (!clean || looksLikeNoise(answer)) return false;
    if (["today", "tomorrow", "asap", "urgent", "flexible", "this week", "next week", "this month", "next month", "no rush"].includes(clean)) return true;
    if (/\b\d+\s*(day|days|week|weeks|month|months)\b/.test(clean)) return true;
    if (/\b(by|before|around|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|next month)\b/.test(clean)) return true;
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/.test(clean)) return true;
    if (/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(clean)) return true;
    return false;
  }

  function validBudgetAnswer(answer = "") {
    const clean = normalizedAnswer(answer);
    if (!clean) return false;
    if (/\d/.test(clean)) return true;
    if (looksLikeNoise(answer)) return false;
    if (["flexible", "not sure", "no idea", "open", "low budget"].includes(clean)) return true;
    return false;
  }

  // The AI intake response occasionally mislabels which question an answer
  // belongs to — most often a timeline reply like "this week" gets written
  // into budget because the two questions are asked back to back. These catch
  // the unambiguous cases (a phrase that is clearly a timeline, or clearly a
  // price, and clearly not the other) so that value can be rejected instead of
  // silently normalized into the wrong field ("This week" -> budget: "This Week").
  function looksLikeTimelineNotBudget(value = "") {
    return validTimelineAnswer(value) && !validBudgetAnswer(value);
  }

  function looksLikeBudgetNotTimeline(value = "") {
    const clean = String(value || "").trim();
    if (!clean) return false;
    const priceShaped = /^\$|^(under|below|at least|over|above)\s*\$?\d|\$?\d+(?:,\d{3})?\s*(?:-|–|to)\s*\$?\d/i.test(clean);
    return priceShaped && !validTimelineAnswer(clean);
  }

  function validTextAnswer(answer = "", minimum = 3) {
    const clean = normalizedAnswer(answer);
    if (!clean || clean.length < minimum || looksLikeNoise(answer)) return false;
    return true;
  }

  function validationQuestion(key) {
    if (key === "timeline") {
      return {
        key: "timeline",
        prompt: "Which timeline should I use?",
        suggestions: ["This week", "This month", "Flexible"],
        placeholder: "Type a date, range, or flexible",
      };
    }
    if (key === "budget") {
      return {
        key: "budget",
        prompt: "Which budget range should I use?",
        suggestions: ["Under $100", "$100-300", "$300-700", "Flexible"],
        placeholder: "Type a budget range",
      };
    }
    if (key === "deliverables") {
      return {
        key: "deliverables",
        prompt: "What should the Hatcher deliver?",
        suggestions: ["Captions", "Visuals", "Posting plan", "All three"],
        placeholder: "Type the expected output",
      };
    }
    if (key === "industry" || key === "businessType") {
      return {
        key,
        prompt: "What kind of business or industry is this for?",
        suggestions: ["Restaurant", "E-commerce", "Local Services", "Education"],
        placeholder: "Type the business or industry",
      };
    }
    return {
      key,
      prompt: "Could you say that in a clearer way?",
      suggestions: [],
      placeholder: "Type a clearer answer",
    };
  }

  function briefSearchText(brief = {}) {
    return [
      brief.title,
      brief.summary,
      brief.businessType,
      brief.industry,
      brief.category,
      ...(brief.deliverables || []),
      brief.sourceText,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function referenceQuestionForBrief(brief = {}) {
    const text = briefSearchText(brief);
    if (text.includes("menu") || text.includes("restaurant") || text.includes("cafe") || text.includes("instagram")) {
      return {
        key: "references",
        prompt: "To make this accurate, the Hatcher needs the menu or food details. Can you provide a menu photo/link, item list with prices, or examples of your current style?",
        suggestions: ["I can attach a menu", "I can paste food items", "No menu yet", "Use best judgment"],
        placeholder: "Paste menu items, prices, links, or notes",
      };
    }
    if (text.includes("website") || text.includes("salon") || text.includes("booking")) {
      return {
        key: "references",
        prompt: "For this website Hatch, the Hatcher needs the services, prices, photos, and any booking link. What can you provide?",
        suggestions: ["Services and prices", "Photos/logo", "Existing website", "No materials yet"],
        placeholder: "Paste services, prices, links, or notes",
      };
    }
    if (text.includes("product") || text.includes("shopify") || text.includes("e-commerce") || text.includes("ecommerce")) {
      return {
        key: "references",
        prompt: "For product work, the Hatcher needs product names, current descriptions, photos, or a store link. What source material do you have?",
        suggestions: ["Product list", "Store link", "Current descriptions", "No materials yet"],
        placeholder: "Paste product details, links, or notes",
      };
    }
    if (text.includes("faq") || text.includes("chatbot") || text.includes("support") || text.includes("reply")) {
      return {
        key: "references",
        prompt: "For customer replies, the Hatcher needs your FAQ, policies, common questions, or examples of your tone. What can you share?",
        suggestions: ["FAQ/policies", "Common questions", "Tone examples", "No materials yet"],
        placeholder: "Paste FAQ, policies, questions, or notes",
      };
    }
    if (text.includes("sheet") || text.includes("workflow") || text.includes("automation") || text.includes("forms")) {
      return {
        key: "references",
        prompt: "For operations work, the Hatcher needs the current process, sample sheet, form, or steps you repeat. What can you provide?",
        suggestions: ["Current process", "Sample sheet", "Form link", "No materials yet"],
        placeholder: "Paste process notes, sheet/form links, or examples",
      };
    }
    return {
      key: "references",
      prompt: "What source material should the Hatcher use: files, examples, links, notes, or existing content?",
      suggestions: ["I have files", "I have links", "No materials yet"],
      placeholder: "Paste a link, note, or source material",
    };
  }

  function questionForSection(sectionId, brief = {}) {
    const key = assistantKeyForSection(sectionId);
    if (key === "timeline") return validationQuestion("timeline");
    if (key === "budget") return validationQuestion("budget");
    if (key === "deliverables") return validationQuestion("deliverables");
    if (key === "businessType") return validationQuestion("businessType");
    if (key === "industry") return validationQuestion("industry");
    if (key === "references") {
      return referenceQuestionForBrief(brief);
    }
    if (key === "constraints") {
      return {
        key: "constraints",
        prompt: "Anything the Hatcher should avoid or keep in mind?",
        suggestions: ["None for now"],
        placeholder: "Type constraints or say none",
      };
    }
    if (sectionId === "summary") {
      return {
        key: "summary",
        prompt: "What outcome matters most for this Hatch?",
        suggestions: [],
        placeholder: "Type the main goal",
      };
    }
    return {
      key,
      prompt: "What should I put for this part?",
      suggestions: [],
      placeholder: "Type your answer",
    };
  }

  function nextOpenSectionId(afterSectionId, completedSet) {
    const ids = briefSectionIds();
    const currentIndex = ids.indexOf(afterSectionId);
    const start = currentIndex >= 0 ? currentIndex + 1 : 0;
    return ids.find((id, index) => index >= start && !completedSet.has(id)) || "";
  }

  function sectionLabel(sectionId) {
    return {
      title: "project",
      businessType: "business",
      summary: "goal",
      deliverables: "deliverables",
      suggestedTimeline: "timeline",
      suggestedBudget: "budget",
      industry: "industry",
      references: "references",
      constraints: "constraints",
    }[sectionId] || "this part";
  }

  function titleCaseShort(text = "") {
    return String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function normalizeMoney(amount) {
    const numeric = String(amount || "").replace(/[^\d.]/g, "");
    if (!numeric) return "";
    const value = Number(numeric);
    if (!Number.isFinite(value)) return "";
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }

  function cleanSentence(text = "") {
    const cleaned = String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^(i\s+want\s+to|i\s+need\s+to|i\s+need|can\s+you|please)\s+/i, "")
      .replace(/\.$/, "");
    if (!cleaned) return "";
    return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}.`;
  }

  function splitListAnswer(text = "") {
    return String(text || "")
      .split(/\n|,|;|\band\b/i)
      .map((item) => cleanSentence(item).replace(/\.$/, ""))
      .filter((item, index, list) => item && list.indexOf(item) === index);
  }

  function normalizeBudgetAnswer(raw = "") {
    const clean = normalizedAnswer(raw);
    if (looksLikeTimelineNotBudget(raw)) return "";
    if (uncertainAnswer(raw) || /\b(not sure|no idea|flexible|open|need guidance)\b/.test(clean)) return "Flexible / needs guidance";
    const rangeMatch = clean.match(/(?:\$?\s*)?(\d+(?:,\d{3})?)(?:\s*(?:-|to|and|–)\s*)(?:\$?\s*)?(\d+(?:,\d{3})?)/);
    if (rangeMatch) {
      const low = normalizeMoney(rangeMatch[1]);
      const high = normalizeMoney(rangeMatch[2]);
      if (low && high) return `${low}–${high}`;
    }
    const underMatch = clean.match(/\b(?:under|below|less than|max|maximum)\s*\$?\s*(\d+(?:,\d{3})?)\b/);
    if (underMatch) return `Under ${normalizeMoney(underMatch[1])}`;
    const overMatch = clean.match(/\b(?:over|above|at least|min|minimum)\s*\$?\s*(\d+(?:,\d{3})?)\b/);
    if (overMatch) return `At least ${normalizeMoney(overMatch[1])}`;
    const numberMatch = clean.match(/\$?\s*(\d+(?:,\d{3})?)\b/);
    if (numberMatch) {
      const amount = Number(String(numberMatch[1]).replace(/[^\d.]/g, ""));
      if (Number.isFinite(amount) && amount > 0) {
        const low = Math.max(25, Math.round(amount * 0.7 / 10) * 10);
        return `${normalizeMoney(low)}–${normalizeMoney(amount)} flexible`;
      }
    }
    return titleCaseShort(raw);
  }

  function normalizeTimelineAnswer(raw = "") {
    const clean = normalizedAnswer(raw);
    if (looksLikeBudgetNotTimeline(raw)) return "";
    if (/\b(asap|urgent|immediately|as soon as possible)\b/.test(clean)) return "As soon as possible";
    if (/\b(no rush|flexible|whenever|not urgent)\b/.test(clean)) return "Flexible";
    if (/\bthis week\b/.test(clean)) return "This week";
    if (/\bnext week\b/.test(clean)) return "Next week";
    if (/\bthis month\b/.test(clean)) return "This month";
    if (/\bnext month\b/.test(clean)) return "Next month";
    const weekday = clean.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (weekday) return `By next ${titleCaseShort(weekday[1])}`;
    const byDate = clean.match(/\b(by|before)\s+(.+)/);
    if (byDate) return `By ${titleCaseShort(byDate[2])}`;
    return titleCaseShort(raw);
  }

  function normalizeAudienceAnswer(raw = "") {
    const clean = normalizedAnswer(raw);
    if (/\bprospective students?\b/.test(clean)) return "Prospective students";
    if (/\bparents?\b/.test(clean) && /\bstudents?\b/.test(clean)) return "Students and parents";
    if (/\bboth\b/.test(clean)) return "Students and parents";
    if (/\bparents?\b/.test(clean)) return "Parents";
    if (/\bgeneral community|community|local community\b/.test(clean)) return "General community";
    if (/\beverybody|everyone|anyone|general public|all people\b/.test(clean)) return "Broad audience";
    return titleCaseShort(raw);
  }

  function normalizeProductTypeAnswer(raw = "") {
    const clean = normalizedAnswer(raw);
    if (/\bdigital\b/.test(clean)) return "Digital product";
    if (/\bphysical\b/.test(clean)) return "Physical product";
    if (/\bservice\b/.test(clean)) return "Service";
    if (/\bsubscription\b/.test(clean)) return "Subscription product";
    return titleCaseShort(raw);
  }

  function normalizeReferenceAnswer(raw = "") {
    const clean = normalizedAnswer(raw);
    const urls = String(raw || "").match(/https?:\/\/[^\s]+/g);
    if (urls?.length) return urls.join(", ");
    if (/\b(no|none|nothing)\b/.test(clean)) return "No source material available yet";
    if (/\b(not yet|no references yet|no menu yet|later|don t have|do not have|dont have|don’t have|don t have right now|no files? right now)\b/.test(clean)) return "No source material available yet";
    if (/\b(use best judgment|you decide|up to you)\b/.test(clean)) return "Use best judgment; no source materials provided yet";
    return cleanSentence(raw).replace(/\.$/, "");
  }

  function normalizeUserAnswer(sectionId, userInput, currentBrief = {}) {
    const key = briefKeyFromAssistantKey(sectionId);
    const raw = String(userInput || "").trim();
    let value = raw;

    if (key === "suggestedBudget") value = normalizeBudgetAnswer(raw);
    else if (key === "suggestedTimeline") value = normalizeTimelineAnswer(raw);
    else if (key === "references") value = normalizeReferenceAnswer(raw);
    else if (key === "constraints") {
      const clean = normalizedAnswer(raw);
      value = /\b(no|none|nothing|not sure)\b/.test(clean) ? "None for now" : splitListAnswer(raw);
    } else if (key === "deliverables") {
      value = splitListAnswer(raw);
      if (!value.length && currentBrief.deliverables?.length) value = currentBrief.deliverables;
    } else if (key === "summary") {
      value = cleanSentence(raw || currentBrief.summary || "Create a clear, usable result.");
    } else if (key === "audience") {
      value = normalizeAudienceAnswer(raw);
    } else if (key === "businessType") {
      value = /product/i.test(currentBrief.activeQuestion || currentBrief.nextQuestion?.prompt || "") ? normalizeProductTypeAnswer(raw) : titleCaseShort(raw);
    } else if (key === "industry") {
      value = titleCaseShort(raw);
    } else if (key === "title") {
      value = cleanSentence(raw).replace(/\.$/, "") || currentBrief.title || "New Hatch";
    }

    console.info("[Hatch debug] normalized answer", {
      activeSection: sectionId,
      normalizedKey: key,
      raw,
      normalizedValue: value,
    });

    return { key, value };
  }

  function normalizedAnswerMessage(sectionId, normalizedValue, nextQuestion) {
    const valueText = Array.isArray(normalizedValue) ? normalizedValue.join(", ") : String(normalizedValue || "");
    const nextText = nextQuestion?.prompt
      ? ` Next, ${nextQuestion.prompt.charAt(0).toLowerCase()}${nextQuestion.prompt.slice(1)}`
      : "";
    if (sectionId === "suggestedBudget") return `That works — I’ll write the budget as ${valueText}.${nextText}`;
    if (sectionId === "suggestedTimeline") return `That works — I’ll write the timeline as ${valueText}.${nextText}`;
    if (sectionId === "deliverables") return `That helps. I cleaned up the deliverables.${nextText}`;
    if (sectionId === "references") return `Got it. I’ve added the source material note.${nextText}`;
    if (sectionId === "constraints") return `Got it. I’ve added that as a constraint.${nextText}`;
    if (sectionId === "summary") return `I’ve turned that into a clearer goal.${nextText}`;
    return `That helps. I’ve updated the ${sectionLabel(sectionId)}.${nextText}`;
  }

  function completeSectionWithAnswer(brief, sectionId, key, answer) {
    const directSectionKey = briefKeyFromAssistantKey(key);
    const normalized = normalizeUserAnswer(directSectionKey, answer, brief);
    const nextBrief = updateBriefObject({ ...brief, updatedAt: new Date().toISOString() }, directSectionKey, normalized.value);
    const completed = new Set(completedSections());
    completed.add(sectionId);
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));

    const nextSectionId = nextOpenSectionId(sectionId, completed);
    if (nextSectionId) {
      const nextIndex = briefSectionIds().indexOf(nextSectionId);
      if (nextIndex >= 0) setActiveSectionIndex(nextIndex);
      const nextQuestion = questionForSection(nextSectionId, nextBrief);
      nextBrief.nextQuestion = nextQuestion;
      nextBrief.assistantMessage = normalizedAnswerMessage(sectionId, normalized.value, nextQuestion);
      nextBrief.stage = "clarifying_missing_info";
      nextBrief.readiness = "Almost Ready";
    } else {
      setActiveSectionIndex(briefSectionIds().length);
      nextBrief.nextQuestion = { key: "none", prompt: "", suggestions: [], placeholder: "" };
      nextBrief.assistantMessage = "That helps. Your Hatch is ready for a final look.";
      nextBrief.stage = "ready_to_post";
      nextBrief.readiness = "Ready to Post";
    }

    console.info("[Hatch debug] flow state", {
      activeSection: sectionId,
      normalizedValue: normalized.value,
      readyToSubmit: nextBrief.stage === "ready_to_post",
    });

    return nextBrief;
  }

  function validateSectionAnswer(key, answer = "", brief = {}) {
    const clean = normalizedAnswer(answer);
    const mappedKey = key === "objective" ? "summary" : key;
    const sectionName = {
      timeline: "timeline",
      budget: "budget",
      deliverables: "deliverables",
      title: "project title",
      businessType: "business",
      summary: "goal",
      industry: "industry",
      references: "references",
      constraints: "constraints",
    }[mappedKey] || "this part";

    if (mappedKey === "timeline" && !validTimelineAnswer(answer)) {
      const maybeFast = clean.includes("fast") || clean.includes("faste") || clean.includes("soon");
      return {
        ok: false,
        message: maybeFast
          ? "I think you mean quickly, but I need an actual timeline. Should I put this week, this month, or flexible?"
          : "I can’t use that as a timeline yet. A date, a range, or flexible works best.",
        question: validationQuestion("timeline"),
      };
    }

    if (mappedKey === "budget" && !validBudgetAnswer(answer)) {
      return {
        ok: false,
        message: "I can’t use that as a budget yet. A rough range is enough, or you can say flexible.",
        question: validationQuestion("budget"),
      };
    }

    if (mappedKey === "deliverables" && !validTextAnswer(answer, 4)) {
      return {
        ok: false,
        message: "I need a clearer output before I add it. For this Hatch, that could be captions, visuals, a posting plan, or all three.",
        question: validationQuestion("deliverables"),
      };
    }

    if (["title", "businessType", "summary", "industry"].includes(mappedKey) && !validTextAnswer(answer, 3)) {
      return {
        ok: false,
        message: `I can’t use that for the ${sectionName} yet. Give me a real word or short phrase for this part.`,
        question: validationQuestion(mappedKey),
      };
    }

    if (["references", "constraints"].includes(mappedKey)) {
      const emptyOkay = ["none", "no", "no references", "no references yet", "nothing", "skip", "skip for now"].includes(clean);
      if (!emptyOkay && !validTextAnswer(answer, 3)) {
        return {
          ok: false,
          message: `I can’t use that for ${sectionName} yet. You can add a real note, or say none for now.`,
          question: validationQuestion(mappedKey),
        };
      }
    }

    return { ok: true };
  }

  function affirmativeAnswer(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return ["yes", "yep", "yeah", "looks good", "good", "that works", "works", "ok", "okay", "perfect", "move on", "next"].includes(clean);
  }

  function skipAnswer(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return ["skip", "skip for now", "leave it", "leave flexible", "keep flexible", "flexible", "not now", "no references yet"].includes(clean);
  }

  function ambiguousPlatformAnswer(answer = "") {
    const clean = answer.toLowerCase().trim();
    return ["instagram", "tiktok", "facebook", "linkedin", "website", "shopify", "canva"].includes(clean);
  }

  function contextualClarificationFallback(brief, key, answer) {
    const nextBrief = {
      ...brief,
      clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      knownRequirements: [...(brief.knownRequirements || []), `${key}: ${answer}`],
      updatedAt: new Date().toISOString(),
    };

    if (!uncertainAnswer(answer)) return null;

    if (key === "timeline") {
      const advice = uncertaintyForSection(brief, key);
      nextBrief.assistantMessage = advice.message;
      nextBrief.nextQuestion = advice.question;
      return nextBrief;
    }

    if (key === "budget") {
      const advice = uncertaintyForSection(brief, key);
      nextBrief.assistantMessage = advice.message;
      nextBrief.nextQuestion = advice.question;
      return nextBrief;
    }

    if (key === "references") {
      nextBrief.references = [...(nextBrief.references || []), "No references yet"];
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "references");
      nextBrief.assistantMessage = "No problem. We can leave references open for now.";
      return nextBrief;
    }

    if (key === "industry") {
      nextBrief.assistantMessage = "No worries. Could you tell me what kind of business or project this is for?";
      return nextBrief;
    }

    nextBrief.assistantMessage = "No worries. Tell me what you know, even if it’s rough.";
    return nextBrief;
  }

  function fallbackClarification(brief, key, answer) {
    if (!brief?.ok || !answer) return brief || { ok: false, error: "No project brief available." };

    const contextual = contextualClarificationFallback(brief, key, answer);
    if (contextual) return contextual;

    const directSectionKey = briefKeyFromAssistantKey(key);
    const sectionKeys = ["title", "businessType", "summary", "deliverables", "suggestedTimeline", "suggestedBudget", "industry", "references", "constraints"];
    const isSectionAnswer = sectionKeys.includes(directSectionKey);
    const validation = validateSectionAnswer(key, answer, brief);

    if (brief.isValidProject && uncertainAnswer(answer) && ["timeline", "budget", "deliverables"].includes(key)) {
      const advice = uncertaintyForSection(brief, key);
      return {
        ...brief,
        assistantMessage: advice.message,
        nextQuestion: advice.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
    }

    if (brief.isValidProject && adviceRequest(answer)) {
      const advice = adviceForSection(brief, key);
      return {
        ...brief,
        assistantMessage: advice.message,
        nextQuestion: advice.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
    }

    if (brief.isValidProject && !validation.ok && isSectionAnswer) {
      return {
        ...brief,
        assistantMessage: validation.message,
        nextQuestion: validation.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
    }

    if (!brief.isValidProject || brief.stage === "invalid_input" || (C.isLowQualityProjectInput(answer, []) && !isSectionAnswer)) {
      const recovered = recoveredBriefFromAnswer(answer, brief);
      if (recovered) return recovered;
      if (C.isLowQualityProjectInput(answer, [])) {
        return {
          ...brief,
          assistantMessage: key === "timeline"
            ? "I’ll keep us on timeline for a moment. You can say something like this week, next month, or flexible."
            : key === "budget"
              ? "I’ll keep us on budget for a moment. You can give a range, or say flexible."
              : key === "references"
                ? "That’s okay. If you don’t have examples, you can say no references yet."
                : invalidGuidance(answer, key),
        };
      }
      const generated = C.generateTaskBrief(answer, []);
      if (!generated.ok) return invalidProjectBrief(answer);
      return {
        ...generated,
        stage: "clarifying_missing_info",
        isValidProject: true,
        confidence: 55,
        assistantMessage: C.fallbackAssistantMessage(generated),
      };
    }

    const nextBrief = {
      ...brief,
      clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      knownRequirements: [...(brief.knownRequirements || []), `${key}: ${answer}`],
      updatedAt: new Date().toISOString(),
    };

    if (isSectionAnswer && validation.ok && !questionLike(answer) && !adviceRequest(answer)) {
      return completeSectionWithAnswer(brief, sectionIdForAssistantKey(key), key, answer);
    }

    if (key === "timeline") {
      nextBrief.suggestedTimeline = answer;
      nextBrief.timelineKnown = true;
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "timeline");
      nextBrief.assistantMessage = "That helps. I’ve updated the timeline.";
    }

    if (key === "budget") {
      nextBrief.suggestedBudget = answer;
      nextBrief.budgetKnown = true;
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "budget");
      nextBrief.assistantMessage = "That helps. I’ve updated the budget.";
    }

    if (key === "industry") {
      nextBrief.businessType = answer;
      nextBrief.industry = answer === "Other" ? "To be confirmed" : answer;
      nextBrief.summary = answer === "Other"
        ? brief.summary
        : `A practical ${answer.toLowerCase()} project ready for a Hatcher to review.`;
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "industry");
      nextBrief.assistantMessage = "That gives me a much clearer picture. I’ve updated the business context.";
    }

    if (key === "references") {
      if (answer !== "No references yet") nextBrief.references = [...(nextBrief.references || []), answer];
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "references");
      nextBrief.assistantMessage = answer === "No references yet"
        ? "No problem. We can leave references open for now."
        : "Perfect. I’ve added that as a reference.";
    }

    return nextBrief;
  }

  async function answerClarification(key, value = "") {
    const inputValue = document.getElementById("clarificationAnswer")?.value.trim() || "";
    const answer = (value || inputValue).trim();
    const brief = getGeneratedBrief();
    if (!brief?.ok || !answer) return;

    setAssistantThinking(true);
    render();

    const nextBrief = await requestProjectIntake({
      mode: "clarify",
      brief,
      key,
      answer,
    });

    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    setAssistantThinking(false);
    render();
  }

  async function sendAssistantReply(value = "") {
    if (assistantTurnInFlight) return;
    const input = document.getElementById("assistantReply");
    const answer = (value || input?.value || "").trim();
    if (!answer) {
      const error = document.getElementById("assistantInputError");
      if (error) {
        error.textContent = "Type a message before sending.";
        error.classList.add("show");
      }
      input?.focus();
      return;
    }
    document.getElementById("assistantInputError")?.classList.remove("show");
    assistantTurnInFlight = true;
    try {
      await handleAssistantTurn(answer);
    } finally {
      assistantTurnInFlight = false;
      // Safety net: if the turn threw mid-flight, don't leave the thinking
      // bubble spinning forever.
      if (localStorage.getItem("hatchAssistantThinking") === "true") {
        setAssistantThinking(false);
        render();
      }
    }
  }

  async function handleAssistantTurn(userMessage = "") {
    const answer = String(userMessage || "").trim();
    const brief = getGeneratedBrief();
    if (!brief?.ok || !answer) return;
    const existingMessages = getAssistantMessages();
    const state = conversationState(brief, existingMessages, answer);
    const sectionId = state.active_section;
    const key = state.expected_answer_type || assistantKeyForSection(sectionId);
    const activeTurn = currentTurnForState(brief, state);
    const missingInfoBefore = brief.missingInfo || [];
    const resolution = resolveAnswerForActiveTurn(brief, state, answer, activeTurn);
    const quickReplyAnswer = Array.isArray(brief.nextQuestion?.suggestions)
      && brief.nextQuestion.suggestions.some((item) => normalizedAnswer(item) === normalizedAnswer(answer));
    const answeredCurrentTurn = Boolean(resolution?.answered || quickReplyAnswer);
    if (answeredCurrentTurn) markTurnAnswered(activeTurn.turnId);
    console.log("[Hatch Bug] activeSection before:", sectionId);
    console.log("[Hatch Bug] activeQuestion before:", state.active_question);
    console.log("[Hatch Bug] userMessage:", answer);
    console.log("[Hatch Bug] expectedAnswerType:", key);
    console.log("[Hatch Bug] turnId:", activeTurn.turnId);
    console.log("[Hatch Bug] quickReplies before:", brief.nextQuestion?.suggestions || []);
    debugFlow("before user reply", {
      active_section: sectionId,
      active_question: state.active_question,
      expected_answer_type: key,
      user_message: answer,
      quick_reply_answer: quickReplyAnswer,
      turn_id: activeTurn.turnId,
      resolved_answer: resolution?.normalizedValue || "",
    });
    window.HatchAIController?.writeState?.({
      activeQuestion: state.active_question,
      activeSection: sectionId,
      expectedAnswerType: key,
      lastUserMessage: answer,
      lastFieldsUpdated: resolution?.fieldsUpdated || [],
      missingInfoBefore,
      missingInfoAfter: missingInfoBefore,
      lastNextQuestion: state.active_question,
      duplicateBlocked: false,
      activeTurn,
    });

    if (!brief.isValidProject || brief.stage === "invalid_input" || Number(brief.confidence || 0) < 40) {
      // Show the user's message + an animated thinking bubble (no placeholder text).
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }]);
      setAssistantThinking(true);
      render();

      const shapedBrief = await requestProjectIntake({
        mode: "organize",
        inputText: [brief.sourceText, answer].filter(Boolean).join("\n"),
        files: brief.files || [],
        brief,
        messages: existingMessages,
      });
      const nextBrief = applyFinalReviewState(shapedBrief, shapedBrief.assistantMessage);
      const turnBrief = attachNextTurn(nextBrief);
      const assistantText = turnBrief.assistantMessage || C.fallbackAssistantMessage(turnBrief);
      mergeInferredProgress(turnBrief);
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(turnBrief));
      setAssistantThinking(false);
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }, ...assistantMessageEntries(assistantText)]);
      render();
      return;
    }

    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify({
      ...brief,
      nextQuestion: { key: "loading", prompt: "", suggestions: [], placeholder: "" },
      activeQuestion: "",
    }));
    saveAssistantMessages([...existingMessages, { role: "user", text: answer }]);
    setAssistantThinking(true);
    render();

    let result = await requestProjectAssistant({
      brief,
      messages: existingMessages,
      conversation_state: {
        ...state,
        active_turn: activeTurn,
        resolved_answer: resolution ? {
          section_id: resolution.sectionId,
          expected_answer_type: resolution.expectedType,
          normalized_value: resolution.normalizedValue,
          fields_updated: resolution.fieldsUpdated,
        } : null,
      },
      key,
      sectionId,
      answer,
      quickReplyAnswer,
      turn: activeTurn,
    });

    console.log("[Hatch Bug] DeepSeek parsed:", result);
    console.log("[Hatch Bug] briefUpdates:", result.brief_updates || result.briefUpdates || result.section_updates || {});
    console.log("[Hatch Bug] fieldsUpdated:", result.fields_updated || result.fieldsUpdated || []);
    console.log("[Hatch Bug] nextQuestion:", result.next_question || result.nextQuestion || "");
    console.log("[Hatch Bug] missingInfo:", result.missing_info || result.missingInfo || result.missing_fields || []);

    // Normalize the full response: `result.brief` is only the nested template
    // summary (project_title, goal, ...) and carries no assistant_message or
    // next_question — normalizing it instead of the whole response replays the
    // previous turn's message and trips the duplicate detector every turn.
    let normalizedBrief = mergeResolvedAnswer(normalizeProjectBrief(result, { mode: "clarify", brief }), resolution);
    let assistantText = result.assistantMessage || result.assistant_message || normalizedBrief.assistantMessage || C.fallbackAssistantMessage(normalizedBrief);
    const previousAssistantText = state.previous_assistant_message || "";
    let duplicateBlocked = false;
    // Only the question the AI itself returned counts for duplicate detection.
    // When it omits next_question, normalizedBrief keeps the previous question,
    // and comparing that against itself is a guaranteed false positive.
    const nextQuestionText = result.next_question || result.nextQuestion || "";
    const duplicateQuestion = answeredCurrentTurn && Boolean(nextQuestionText) && isSameQuestion(state.active_question, nextQuestionText);
    const duplicateMessage = isDuplicateAssistantMessage(previousAssistantText, assistantText);
    if (duplicateQuestion || duplicateMessage) {
      duplicateBlocked = true;
      console.warn("[Hatch Bug] duplicate assistant message blocked:", assistantText);
      result = await requestProjectAssistant({
        brief: resolution?.brief || brief,
        messages: existingMessages,
        conversation_state: {
          ...state,
          active_turn: activeTurn,
          resolved_answer: resolution ? {
            section_id: resolution.sectionId,
            expected_answer_type: resolution.expectedType,
            normalized_value: resolution.normalizedValue,
            fields_updated: resolution.fieldsUpdated,
          } : null,
          duplicate_retry_instruction: `The user already answered this question: ${answer}. Save it and ask the next unresolved question.`,
        },
        key,
        sectionId,
        answer,
        quickReplyAnswer,
        turn: activeTurn,
        duplicateRetry: true,
      });
      console.log("[Hatch Bug] DeepSeek retry parsed:", result);
      normalizedBrief = mergeResolvedAnswer(normalizeProjectBrief(result, { mode: "clarify", brief }), resolution);
      assistantText = result.assistantMessage || result.assistant_message || normalizedBrief.assistantMessage || C.fallbackAssistantMessage(normalizedBrief);
      const retryQuestionText = result.next_question || result.nextQuestion || "";
      if ((answeredCurrentTurn && Boolean(retryQuestionText) && isSameQuestion(state.active_question, retryQuestionText)) || isDuplicateAssistantMessage(previousAssistantText, assistantText)) {
        const recovered = applyAnsweredQuestionLocally(brief, state, answer);
        if (recovered) {
          localStorage.setItem("hatchAiIntakeMode", "local-fallback");
          localStorage.setItem("hatchAiLastError", "Local fallback is being used. DeepSeek repeated its previous response.");
          window.HatchAIController?.writeState?.({
            fallbackUsed: true,
            lastProvider: "Local fallback",
            lastModel: "",
            lastIntent: "DUPLICATE_FALLBACK",
            lastUserMessage: answer,
            lastAssistantSource: "local-fallback",
            lastError: "Local fallback is being used. DeepSeek repeated its previous response.",
            duplicateBlocked: true,
          });
          normalizedBrief = recovered;
          assistantText = recovered.assistantMessage;
        }
      }
    }
    let nextBrief = attachNextTurn(applyFinalReviewState(normalizedBrief, assistantText));
    const lastStoredAssistantText = lastAssistantTurnText(existingMessages);
    const finalAssistantText = nextBrief.assistantMessage || assistantText;
    if (answeredCurrentTurn && isDuplicateAssistantMessage(lastStoredAssistantText, finalAssistantText)) {
      duplicateBlocked = true;
      console.warn("[Hatch Bug] final duplicate render blocked:", finalAssistantText);
      const recovered = recoveredBriefAfterDuplicate(brief, state, answer, resolution);
      if (recovered) {
        localStorage.setItem("hatchAiIntakeMode", "local-fallback");
        localStorage.setItem("hatchAiLastError", "Local fallback is being used. DeepSeek repeated its previous response.");
        nextBrief = attachNextTurn(applyFinalReviewState(recovered, recovered.assistantMessage));
        assistantText = nextBrief.assistantMessage || recovered.assistantMessage;
        window.HatchAIController?.writeState?.({
          fallbackUsed: true,
          lastProvider: "Local fallback",
          lastModel: "",
          lastIntent: "FINAL_DUPLICATE_FALLBACK",
          lastUserMessage: answer,
          lastAssistantSource: "local-fallback",
          lastError: "Local fallback is being used. DeepSeek repeated its previous response.",
          duplicateBlocked: true,
        });
      }
    }
    mergeInferredProgress(nextBrief);
    const fieldsUpdated = [
      ...(result.fields_updated || result.fieldsUpdated || []),
      ...(nextBrief.fieldsUpdated || []),
      ...(resolution?.fieldsUpdated || []),
    ].filter(Boolean);
    const missingInfoAfter = nextBrief.missingInfo || [];
    debugFlow("after DeepSeek reply", {
      updated_section: nextBrief.completedSectionId || nextBrief.activeSection || sectionId,
      fallback_used: localStorage.getItem("hatchAiIntakeMode") !== "connected",
      next_section: nextBrief.activeSection || nextBrief.nextQuestion?.key || "",
      readiness: nextBrief.readiness,
      duplicate_blocked: duplicateBlocked,
      missing_before: missingInfoBefore,
      missing_after: missingInfoAfter,
    });
    console.log("[Hatch Bug] activeSection after:", nextBrief.activeSection || nextBrief.nextQuestion?.key || "");
    console.log("[Hatch Bug] missingInfo after:", missingInfoAfter);
    window.HatchAIController?.writeState?.({
      activeQuestion: nextBrief.activeQuestion || nextBrief.nextQuestion?.prompt || "",
      activeSection: nextBrief.activeSection || sectionId,
      expectedAnswerType: nextBrief.expectedAnswerType || nextBrief.nextQuestion?.key || key,
      lastUserMessage: answer,
      lastFieldsUpdated: fieldsUpdated,
      missingInfoBefore,
      missingInfoAfter,
      lastNextQuestion: nextBrief.nextQuestion?.prompt || "",
      duplicateBlocked,
      activeTurn: nextBrief.currentTurn || null,
    });
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    setAssistantThinking(false);
    saveAssistantMessages([...existingMessages, { role: "user", text: answer }, ...assistantMessageEntries(nextBrief.assistantMessage || assistantText)]);
    if (nextBrief.stage === "ready_to_post") {
      render();
      return;
    }
    if (nextBrief.completedSectionId) {
      const completed = new Set(completedSections());
      completed.add(nextBrief.completedSectionId);
      localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
      render();
      return;
    }
    render();
  }

  function updateBriefObject(nextBrief, key, value) {
    const scalarValue = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean).join(", ")
      : String(value || "").trim();
    const listValue = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : String(value || "")
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

    if (key === "title") nextBrief.title = scalarValue;
    if (key === "summary") nextBrief.summary = scalarValue;
    if (key === "businessType") nextBrief.businessType = scalarValue;
    if (key === "audience") nextBrief.audience = scalarValue;
    if (key === "industry") nextBrief.industry = scalarValue;
    if (key === "suggestedBudget") {
      nextBrief.suggestedBudget = scalarValue;
      nextBrief.budgetKnown = Boolean(scalarValue);
    }
    if (key === "suggestedTimeline") {
      nextBrief.suggestedTimeline = scalarValue;
      nextBrief.timelineKnown = Boolean(scalarValue);
    }
    if (key === "suggestedLevel") nextBrief.suggestedLevel = scalarValue || "L1";
    if (key === "deliverables") nextBrief.deliverables = listValue;
    if (key === "references") nextBrief.references = listValue;
    if (key === "constraints") nextBrief.constraints = listValue;

    const missing = new Set(nextBrief.missingInfo || []);
    if (nextBrief.title && nextBrief.summary) missing.delete("objective");
    if (nextBrief.businessType || nextBrief.industry) missing.delete("industry");
    if (nextBrief.audience) {
      missing.delete("audience");
      missing.delete("school type");
      missing.delete("target audience");
    }
    if (nextBrief.deliverables?.length) missing.delete("deliverables");
    if (nextBrief.suggestedBudget) missing.delete("budget");
    if (nextBrief.suggestedTimeline) missing.delete("timeline");
    nextBrief.missingInfo = [...missing];
    if (nextBrief.title || nextBrief.summary || nextBrief.deliverables?.length) {
      nextBrief.isValidProject = true;
      nextBrief.confidence = Math.max(Number(nextBrief.confidence || 0), 55);
      nextBrief.stage = nextBrief.missingInfo.length ? "clarifying_missing_info" : "ready_to_post";
      nextBrief.readiness = nextBrief.missingInfo.length ? "Almost Ready" : "Ready to Post";
    }
    if (nextBrief.isValidProject && !nextBrief.missingInfo.length) {
      nextBrief.stage = "ready_to_post";
      nextBrief.readiness = "Ready to Post";
      nextBrief.nextQuestion = { key: "none", prompt: "", suggestions: [], placeholder: "" };
    }

    return nextBrief;
  }

  function updateBriefField(key, value) {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const nextBrief = updateBriefObject({ ...brief, updatedAt: new Date().toISOString() }, key, value);

    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    localStorage.removeItem("hatchBriefEditKey");
    render();
  }

  function sectionMessages() {
    return readJson("hatchSectionMessages", {});
  }

  function saveSectionMessage(sectionId, message) {
    const messages = sectionMessages();
    messages[sectionId] = [...(messages[sectionId] || []), message].slice(-4);
    localStorage.setItem("hatchSectionMessages", JSON.stringify(messages));
  }

  function completedSections() {
    return readJson("hatchCompletedSections", []);
  }

  function setActiveSectionIndex(index) {
    localStorage.setItem("hatchActiveSectionIndex", String(Math.max(0, index)));
  }

  function briefSectionIds() {
    return ["title", "businessType", "summary", "deliverables", "suggestedTimeline", "suggestedBudget", "industry", "references", "constraints"];
  }

  function activeSectionId() {
    const ids = briefSectionIds();
    const index = Number(localStorage.getItem("hatchActiveSectionIndex") || 0);
    return ids[index] || "general";
  }

  function assistantKeyForSection(sectionId) {
    return {
      suggestedTimeline: "timeline",
      suggestedBudget: "budget",
      businessType: "business",
      title: "project",
      summary: "goal",
    }[sectionId] || sectionId;
  }

  function expectedTypeFromQuestion(question = "", fallback = "general") {
    const text = String(question || "").toLowerCase();
    if (text.includes("budget") || text.includes("$") || text.includes("price")) return "budget";
    if (text.includes("timeline") || text.includes("deadline") || text.includes("when") || text.includes("finished")) return "timeline";
    if (text.includes("deliver") || text.includes("output") || text.includes("hand back")) return "deliverables";
    if (text.includes("who is this for") || text.includes("audience") || text.includes("school") || text.includes("students")) return "audience";
    if (text.includes("app name") || text.includes("business name") || text.includes("brand name") || text.includes("name of your app") || text.includes("app or business")) return "business_name";
    if (text.includes("industry") || text.includes("business") || text.includes("company") || text.includes("cafe") || text.includes("restaurant")) return "business";
    if (text.includes("reference") || text.includes("file") || text.includes("example") || text.includes("materials")) return "references";
    if (text.includes("constraint") || text.includes("tone") || text.includes("style")) return "constraints";
    return fallback;
  }

  function conversationState(brief = {}, messages = [], latestAnswer = "") {
    const activeSection = sectionIdFromUpdateKey(brief.activeSection || brief.nextQuestion?.key || activeSectionId());
    const activeQuestion = brief.activeQuestion || brief.nextQuestion?.prompt || "";
    const previousAssistantMessage = lastAssistantTurnText(messages);
    const expectedAnswerType = expectedTypeFromQuestion(
      activeQuestion,
      brief.expectedAnswerType || assistantKeyForSection(activeSection),
    );
    return {
      active_section: activeSection,
      active_question: activeQuestion,
      expected_answer_type: expectedAnswerType,
      brief,
      conversation_history: messages,
      previous_assistant_message: previousAssistantMessage,
      latest_user_message: latestAnswer,
      missing_fields: brief.missingInfo || [],
      readiness: brief.readiness || brief.stage || "needs_context",
      last_assistant_intent: brief.lastAssistantIntent || "",
      last_user_answer: latestAnswer,
    };
  }

  function requiredHatchFieldsComplete(brief = {}) {
    const hasText = (value) => String(value || "").trim().length > 0;
    const hasList = (value) => Array.isArray(value) && value.filter(Boolean).length > 0;
    return Boolean(
      hasText(brief.title)
      && hasText(brief.summary)
      && (hasText(brief.clientContext) || hasText(brief.businessType) || hasText(brief.industry))
      && (hasList(brief.scope) || hasList(brief.deliverables))
      && hasList(brief.deliverables)
      && hasText(brief.suggestedBudget)
      && hasText(brief.suggestedTimeline)
    );
  }

  function readinessTriggersFinalReview(brief = {}, assistantText = "") {
    const readiness = String(brief.readiness || brief.stage || "").toLowerCase();
    const canSubmit = brief.canSubmit === true || brief.can_submit === true || brief.readyToSubmit === true || brief.stage === "ready_to_post";
    const missingInfo = Array.isArray(brief.missingInfo) ? brief.missingInfo.filter(Boolean) : [];
    const messageReady = /ready to post|brief is ready|finalize the brief/i.test(assistantText || brief.assistantMessage || "");
    const allRequiredComplete = requiredHatchFieldsComplete(brief);
    const finalReviewTriggered = Boolean(
      /ready_to_post|ready to post/.test(readiness)
      || canSubmit
      || messageReady
      || (brief.isValidProject && missingInfo.length === 0)
      || allRequiredComplete
    );

    console.log("[Hatch Flow] readiness:", brief.readiness || brief.stage || "");
    console.log("[Hatch Flow] canSubmit:", canSubmit);
    console.log("[Hatch Flow] missingInfo:", missingInfo);
    console.log("[Hatch Flow] finalReviewTriggered:", finalReviewTriggered);

    return finalReviewTriggered;
  }

  function cleanFinalAssistantMessage(message = "") {
    const clean = String(message || "").replace(/\b(if not,\s*)?I[’']ll submit it\.?/gi, "If this looks good, you can submit it next.");
    if (/ready to post|brief is ready|finalize the brief/i.test(clean)) {
      return clean || "Your Hatch is ready. If this looks good, you can submit it next.";
    }
    return "Your Hatch is ready. If this looks good, you can submit it next.";
  }

  function applyFinalReviewState(brief = {}, assistantText = "") {
    if (!brief?.ok || localStorage.getItem("hatchFinalReviewDismissed") === "true") return brief;
    if (!readinessTriggersFinalReview(brief, assistantText)) return brief;
    const ids = briefSectionIds();
    setActiveSectionIndex(ids.length);
    localStorage.setItem("hatchCompletedSections", JSON.stringify(ids));
    localStorage.removeItem("hatchBriefEditKey");
    localStorage.removeItem("hatchShowFinalEditSections");
    return {
      ...brief,
      stage: "ready_to_post",
      readiness: "Ready to Post",
      canSubmit: true,
      missingInfo: [],
      nextQuestion: { key: "review", prompt: "", suggestions: [], placeholder: "" },
      assistantMessage: cleanFinalAssistantMessage(assistantText || brief.assistantMessage),
    };
  }

  function confirmSection(sectionId) {
    const brief = getGeneratedBrief();
    if (brief?.ok && (sectionId === "suggestedTimeline" || sectionId === "suggestedBudget")) {
      const nextBrief = { ...brief };
      if (sectionId === "suggestedTimeline" && nextBrief.suggestedTimeline) {
        nextBrief.timelineKnown = true;
        nextBrief.missingInfo = removeMissingInfo(nextBrief, "timeline");
      }
      if (sectionId === "suggestedBudget" && nextBrief.suggestedBudget) {
        nextBrief.budgetKnown = true;
        nextBrief.missingInfo = removeMissingInfo(nextBrief, "budget");
      }
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    }
    const completed = new Set(completedSections());
    completed.add(sectionId);
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
    saveSectionMessage(sectionId, "Nice, that’s enough for this section.");
    if (localStorage.getItem("hatchReturnToFinalReview") === "true") {
      setActiveSectionIndex(briefSectionIds().length);
      localStorage.removeItem("hatchReturnToFinalReview");
      localStorage.removeItem("hatchBriefEditKey");
      render();
      return;
    }
    moveToNextSection();
  }

  function moveToNextSection() {
    const ids = briefSectionIds();
    const completed = new Set(completedSections());
    const current = Number(localStorage.getItem("hatchActiveSectionIndex") || 0);
    const next = ids.findIndex((id, index) => index > current && !completed.has(id));
    setActiveSectionIndex(next === -1 ? ids.length : next);
    localStorage.removeItem("hatchBriefEditKey");
    render();
  }

  function editBriefField(key) {
    localStorage.setItem("hatchBriefEditKey", key);
    render();
  }

  function editSection(sectionId) {
    const index = briefSectionIds().indexOf(sectionId);
    if (index >= 0) setActiveSectionIndex(index);
    editBriefField(sectionId);
    saveSectionMessage(sectionId, "No worries — write this however you like. I’ll clean it up after.");
  }

  function cancelBriefEdit() {
    localStorage.removeItem("hatchBriefEditKey");
    render();
  }

  function updateSection(sectionId, value) {
    saveSectionMessage(sectionId, "That helps. I’ve updated this section.");
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const normalized = normalizeUserAnswer(sectionId, value, brief);
    const nextBrief = updateBriefObject({ ...brief, updatedAt: new Date().toISOString() }, sectionId, normalized.value);
    nextBrief.assistantMessage = "That helps — I cleaned it up a little below.";
    const completed = new Set(completedSections());
    completed.add(sectionId);
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    localStorage.removeItem("hatchBriefEditKey");
    if (localStorage.getItem("hatchReturnToFinalReview") === "true") {
      setActiveSectionIndex(briefSectionIds().length);
      localStorage.removeItem("hatchReturnToFinalReview");
    }
    saveAssistantMessages([...getAssistantMessages(), ...assistantMessageEntries(nextBrief.assistantMessage)]);
    render();
  }

  function rewriteSection(sectionId) {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const nextBrief = { ...brief };
    const source = brief.sourceText || localStorage.getItem("skillnestDraftTask") || "";
    const current = {
      title: brief.title,
      businessType: brief.businessType,
      summary: brief.summary,
      deliverables: brief.deliverables,
      suggestedTimeline: brief.suggestedTimeline,
      suggestedBudget: brief.suggestedBudget,
      industry: brief.industry,
      references: brief.references,
      constraints: brief.constraints,
    }[sectionId];

    const fallbackText = source.length > 80 ? source.slice(0, 120).trim() : source.trim();
    if (sectionId === "title") nextBrief.title = polishSectionValue(sectionId, brief, brief.title || C.buildTaskBrief(source).title || "Clear project brief");
    if (sectionId === "businessType") nextBrief.businessType = polishSectionValue(sectionId, brief, brief.businessType && brief.businessType !== "To be confirmed" ? brief.businessType : (brief.industry || "Business to confirm"));
    if (sectionId === "summary") nextBrief.summary = polishSectionValue(sectionId, brief, brief.summary || fallbackText || "Turn the idea into a clear, usable result.");
    if (sectionId === "deliverables") nextBrief.deliverables = Array.isArray(current) && current.length ? current : ["Clear first draft", "Editable final files", "Notes for handoff"];
    if (sectionId === "suggestedTimeline") {
      nextBrief.suggestedTimeline = brief.suggestedTimeline || "Flexible";
      nextBrief.timelineKnown = true;
    }
    if (sectionId === "suggestedBudget") {
      nextBrief.suggestedBudget = brief.suggestedBudget || "Flexible";
      nextBrief.budgetKnown = true;
    }
    if (sectionId === "industry") nextBrief.industry = brief.industry && brief.industry !== "General business" ? brief.industry : "General";
    if (sectionId === "references") nextBrief.references = Array.isArray(current) && current.length ? current : ["No references yet"];
    if (sectionId === "constraints") nextBrief.constraints = Array.isArray(current) && current.length ? current : ["Keep it simple and easy to use"];

    nextBrief.missingInfo = (nextBrief.missingInfo || []).filter((item) => item !== sectionId);
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    saveSectionMessage(sectionId, "Here’s a tighter version.");
    saveAssistantMessages([...getAssistantMessages(), ...assistantMessageEntries("Here’s a tighter version.")]);
    render();
  }

  function polishSectionValue(sectionId, brief, value) {
    const text = String(value || "").trim();
    if (sectionId === "title") return text.replace(/\s+/g, " ").replace(/\.$/, "") || "Clear project brief";
    if (sectionId === "businessType") return text || brief.industry || "Business to confirm";
    if (sectionId === "summary") {
      if (!text) return "Create a clear, usable result that matches the client’s goal.";
      return text.length > 180 ? `${text.slice(0, 177).trim()}...` : text;
    }
    if (sectionId === "suggestedTimeline") return text || "Flexible";
    if (sectionId === "suggestedBudget") return text || "Flexible";
    if (sectionId === "industry") return text || "General";
    if (sectionId === "references") return text || "No references yet";
    if (sectionId === "constraints") return text || "Keep the work simple and easy to use";
    return text;
  }

  function handleAssistantReplyKey(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    sendAssistantReply();
  }

  function updateLiveTaskPreview() {
    const prompt = document.getElementById("taskPrompt");
    const target = document.getElementById("taskLivePreview");
    if (!target) return;
    target.innerHTML = C.taskPreviewMarkup(prompt?.value || "", readJson("skillnestDraftFiles", []));
  }

  function renderFilePreviews() {
    const lists = [...document.querySelectorAll("[data-file-preview]")];
    const files = readJson("skillnestDraftFiles", []);
    const labelOptions = ["Services and prices", "Photos/logo", "Existing website", "Menu/items", "Brand examples", "Notes", "Other material"];
    if (!lists.length) return;
    if (!files.length) {
      lists.forEach((list) => {
        list.innerHTML = list.classList.contains("review-file-preview-list")
          ? `<div class="file-preview-empty">No files attached yet</div>`
          : "";
      });
      return;
    }
    const markup = files.map((file, index) => {
      const size = file.size ? `${Math.ceil(file.size / 1024)} KB` : "Size unavailable";
      const type = file.type || "file";
      const materialType = file.materialType || "Other material";
      const sessionUrl = file.objectUrl || (file.sessionId ? fileObjectUrls.get(file.sessionId) : "");
      return `
        <article class="file-preview">
          <div>
            <strong>${C.escapeHtml(file.name || file)}</strong>
            <span>${C.escapeHtml(type)} · ${size}</span>
            <label class="file-label-control">
              <span>Label</span>
              <select onchange="SkillNestApp.updateDraftFileLabel(${index}, this.value)">
                ${labelOptions.map((option) => `<option value="${C.escapeHtml(option)}"${option === materialType ? " selected" : ""}>${C.escapeHtml(option)}</option>`).join("")}
                ${labelOptions.includes(materialType) ? "" : `<option value="${C.escapeHtml(materialType)}" selected>${C.escapeHtml(materialType)}</option>`}
              </select>
            </label>
          </div>
          <div class="file-preview-actions">
            ${sessionUrl ? `<button class="btn ghost small" type="button" onclick="SkillNestApp.previewDraftFile(${index})">Preview</button>` : ""}
            ${sessionUrl ? `<button class="btn ghost small" type="button" onclick="SkillNestApp.downloadDraftFile(${index})">Download</button>` : ""}
            ${sessionUrl ? "" : `<span class="file-unavailable">Preview after reload needs real storage</span>`}
          </div>
          <button class="btn ghost small danger" type="button" onclick="SkillNestApp.removeDraftFile(${index})">Remove</button>
        </article>
      `;
    }).join("");
    lists.forEach((list) => {
      list.innerHTML = markup;
    });
  }

  function syncFilesIntoBrief(files, options = {}) {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const existingReferences = Array.isArray(brief.references) ? brief.references : [];
    const references = [...new Set([
      ...existingReferences.filter((item) => !String(item || "").startsWith("Attached ")),
      ...files.map((file) => `Attached ${file.materialType || "file"}: ${file.name || file}`),
    ])];
    const nextBrief = {
      ...brief,
      files,
      references,
      updatedAt: new Date().toISOString(),
    };
    nextBrief.missingInfo = removeMissingInfo(nextBrief, "references");

    if (options.completeReferences && activeSectionId() === "references") {
      const completed = new Set(completedSections());
      completed.add("references");
      localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
      const nextSectionId = nextOpenSectionId("references", completed);
      if (nextSectionId) {
        const nextIndex = briefSectionIds().indexOf(nextSectionId);
        if (nextIndex >= 0) setActiveSectionIndex(nextIndex);
        const nextQuestion = questionForSection(nextSectionId, nextBrief);
        nextBrief.nextQuestion = nextQuestion;
        nextBrief.assistantMessage = `I’ve added the files as source material. Next, ${nextQuestion.prompt.charAt(0).toLowerCase()}${nextQuestion.prompt.slice(1)}`;
      } else {
        setActiveSectionIndex(briefSectionIds().length);
        nextBrief.assistantMessage = "I’ve added the files as source material. Your Hatch is ready for a final look.";
        nextBrief.stage = "ready_to_post";
        nextBrief.readiness = "Ready to Post";
      }
      saveAssistantMessages([...getAssistantMessages(), ...assistantMessageEntries(nextBrief.assistantMessage)]);
    }

    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
  }

  function attachReferenceMaterial(materialType = "Other material") {
    localStorage.setItem("hatchPendingFileMaterial", materialType);
    document.getElementById("reviewTaskFile")?.click();
  }

  // Same idea as attachReferenceMaterial, but for the "+" menu next to the
  // reply box — available any time the conversation compose bar is showing,
  // not just on the dedicated references step.
  function attachComposeFile(materialType = "Other material") {
    localStorage.setItem("hatchPendingFileMaterial", materialType);
    document.getElementById("composeAttachFile")?.click();
  }

  function updateDraftFileLabel(index, materialType) {
    const files = readJson("skillnestDraftFiles", []);
    if (!files[index]) return;
    files[index] = { ...files[index], materialType };
    localStorage.setItem("skillnestDraftFiles", JSON.stringify(files));
    syncFilesIntoBrief(files);
    renderFilePreviews();
    if (currentRoute() === "task-review") render();
  }

  function sessionUrlForFile(file) {
    if (!file) return "";
    if (file.sessionId) return fileObjectUrls.get(file.sessionId) || "";
    return file.objectUrl || "";
  }

  function previewFileObject(file) {
    const url = sessionUrlForFile(file);
    if (!url) {
      window.alert("Preview is only available during the upload session. A real version would store files in secure cloud storage.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  function downloadFileObject(file) {
    const url = sessionUrlForFile(file);
    if (!url) {
      window.alert("Download is only available during the upload session in this MVP.");
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name || "hatch-file";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function previewDraftFile(index) {
    previewFileObject(hydrateSessionFiles(readJson("skillnestDraftFiles", []))[index]);
  }

  function downloadDraftFile(index) {
    downloadFileObject(hydrateSessionFiles(readJson("skillnestDraftFiles", []))[index]);
  }

  function previewTaskFile(taskId, index) {
    const task = marketplaceTasks().find((item) => item.id === taskId);
    previewFileObject(task?.files?.[index]);
  }

  function downloadTaskFile(taskId, index) {
    const task = marketplaceTasks().find((item) => item.id === taskId);
    downloadFileObject(task?.files?.[index]);
  }

  function removePostedTaskFile(taskId, index) {
    const postedTasks = getPostedTasks();
    const taskIndex = postedTasks.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) return;
    const files = Array.isArray(postedTasks[taskIndex].files) ? [...postedTasks[taskIndex].files] : [];
    files.splice(index, 1);
    postedTasks[taskIndex] = { ...postedTasks[taskIndex], files };
    localStorage.setItem(postedTasksKey(), JSON.stringify(postedTasks));
    render();
    openTaskDetail(taskId);
  }

  function useTaskChip(text) {
    const prompt = document.getElementById("taskPrompt");
    if (prompt) {
      prompt.value = text;
      updateLiveTaskPreview();
    }
  }

  function useExampleTask() {
    const prompt = document.getElementById("taskPrompt");
    if (!prompt) return;
    const exampleText = "I run a small cafe and need a Hatcher to turn my menu and daily specials into 30 Instagram captions, a simple posting calendar, and a few Canva template ideas.";
    prompt.value = prompt.value.trim() ? `${prompt.value.trim()}\n\n${exampleText}` : exampleText;
    const summary = document.getElementById("fileSummary");
    if (summary) {
      summary.textContent = "Example added. Edit it before continuing.";
      summary.classList.add("show");
    }
    updateLiveTaskPreview();
  }

  function setVoiceStatus(message, state = "") {
    const status = document.getElementById("voiceStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `voice-status show ${state}`.trim();
  }

  function appendTranscript(text) {
    const prompt = document.getElementById("taskPrompt");
    if (!prompt || !text.trim()) return;
    const cleanText = text.trim();
    prompt.value = prompt.value.trim() ? `${prompt.value.trim()} ${cleanText}` : cleanText;
    voiceSessionText = voiceSessionText ? `${voiceSessionText} ${cleanText}` : cleanText;
    saveDraftTask();
    updateLiveTaskPreview();
  }

  function updateVoiceControls() {
    const button = document.getElementById("voiceInputButton");
    const pauseButton = document.getElementById("voicePauseButton");
    const stopButton = document.getElementById("voiceStopButton");
    const deleteButton = document.getElementById("voiceDeleteButton");

    if (button) {
      button.textContent = isVoiceListening ? "Listening..." : isVoicePaused ? "Resume voice" : "Voice input";
      button.disabled = isVoiceListening;
    }
    pauseButton?.classList.toggle("hidden", !isVoiceListening);
    stopButton?.classList.toggle("hidden", !isVoiceListening && !isVoicePaused);
    deleteButton?.classList.toggle("hidden", !voiceSessionText.trim());
  }

  function resetVoiceSession() {
    isVoiceListening = false;
    isVoicePaused = false;
    updateVoiceControls();
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus("Voice input is not supported in this browser yet.", "error");
      return;
    }

    isVoicePaused = false;
    if (!voiceRecognition) {
      voiceRecognition = new SpeechRecognition();
      voiceRecognition.lang = "en-US";
      voiceRecognition.interimResults = true;
      voiceRecognition.continuous = true;
    }
    voiceHadTranscript = false;

    // Backend-ready: for production, send audio to a secure server route for transcription.
    voiceRecognition.onstart = () => {
      isVoiceListening = true;
      isVoicePaused = false;
      updateVoiceControls();
      setVoiceStatus("Listening. Pause or stop whenever you’re done.", "listening");
    };

    voiceRecognition.onresult = (event) => {
      const transcript = [...event.results]
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      appendTranscript(transcript);
      voiceHadTranscript = Boolean(transcript);
      if (voiceHadTranscript) setVoiceStatus("Transcript added. Keep speaking, pause, or stop when ready.", "success");
      updateVoiceControls();
    };

    voiceRecognition.onerror = (event) => {
      const message = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone permission was denied."
        : "Voice input paused. You can resume or type instead.";
      setVoiceStatus(message, "error");
      isVoiceListening = false;
      isVoicePaused = event.error !== "not-allowed" && event.error !== "service-not-allowed";
      updateVoiceControls();
    };

    voiceRecognition.onend = () => {
      isVoiceListening = false;
      if (!isVoicePaused && voiceRecognition) {
        try {
          voiceRecognition.start();
          return;
        } catch {
          setVoiceStatus(voiceHadTranscript ? "Voice input paused. You can resume or continue typing." : "Voice input paused. No transcript was added yet.", "");
          isVoicePaused = true;
        }
      } else if (!voiceHadTranscript && !voiceSessionText.trim()) {
        setVoiceStatus("Voice input paused. No transcript was added yet.", "");
      }
      updateVoiceControls();
    };

    try {
      voiceRecognition.start();
    } catch {
      setVoiceStatus("Voice input could not start. Try again in a moment.", "error");
      resetVoiceSession();
    }
  }

  function stopVoiceInput() {
    isVoicePaused = true;
    if (voiceRecognition && isVoiceListening) voiceRecognition.stop();
    isVoiceListening = false;
    setVoiceStatus(voiceSessionText.trim() ? "Voice input stopped. You can edit the text before continuing." : "Voice input stopped.", voiceSessionText.trim() ? "success" : "");
    updateVoiceControls();
  }

  function pauseVoiceInput() {
    isVoicePaused = true;
    if (voiceRecognition && isVoiceListening) voiceRecognition.stop();
    isVoiceListening = false;
    setVoiceStatus("Voice input paused. Resume when you’re ready.", "");
    updateVoiceControls();
  }

  function deleteVoiceTranscript() {
    const prompt = document.getElementById("taskPrompt");
    if (prompt && voiceSessionText.trim()) {
      const escaped = voiceSessionText.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      prompt.value = prompt.value
        .replace(new RegExp(`\\s*${escaped}\\s*`, "g"), " ")
        .replace(/\s+/g, " ")
        .trim();
      saveDraftTask();
      updateLiveTaskPreview();
    }
    voiceSessionText = "";
    setVoiceStatus("Voice text deleted.", "");
    updateVoiceControls();
  }

  function toggleVoiceInput() {
    if (!isVoiceListening) startVoiceInput();
  }

  function simulateVoiceInput() {
    useExampleTask();
  }

  // MAX_DRAFT_FILE_BYTES caps each attached file so it fits safely in
  // localStorage (shared across the whole app, ~5-10MB quota) and in the
  // request that eventually submits the Hatch. This is a local demo backend
  // with no real object storage — files live as base64 data URLs, not as
  // uploads to cloud storage.
  const MAX_DRAFT_FILE_BYTES = 3 * 1024 * 1024;

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
      reader.readAsDataURL(file);
    });
  }

  async function handleTaskFiles(event) {
    const input = event.target;
    const chosen = [...(input.files || [])];
    if (!chosen.length) return;

    const oversized = chosen.filter((file) => file.size > MAX_DRAFT_FILE_BYTES);
    const accepted = chosen.filter((file) => file.size <= MAX_DRAFT_FILE_BYTES);
    if (oversized.length) {
      window.alert(`${oversized.length === 1 ? "This file is" : "These files are"} over 3 MB and can't be attached: ${oversized.map((file) => file.name).join(", ")}.`);
    }
    if (!accepted.length) {
      input.value = "";
      return;
    }

    const materialType = localStorage.getItem("hatchPendingFileMaterial") || "Other material";
    let readFiles;
    try {
      // objectUrl carries a real, durable data: URL now (not a session-only
      // blob: pointer) — the field name is kept so every existing preview/
      // download/marketplace code path that reads file.objectUrl needs no changes.
      readFiles = await Promise.all(accepted.map(async (file) => ({
        name: file.name,
        type: file.type || "file",
        size: file.size || 0,
        materialType,
        objectUrl: await readFileAsDataUrl(file),
      })));
    } catch (error) {
      window.alert(error.message || "One of those files could not be read. Please try again.");
      input.value = "";
      return;
    }

    const existing = readJson("skillnestDraftFiles", []);
    const nextFiles = [...existing, ...readFiles];
    if (!trySetLocalStorage("skillnestDraftFiles", nextFiles)) {
      window.alert("These files are too large to attach together. Try removing one or attaching fewer at a time.");
      input.value = "";
      return;
    }
    localStorage.removeItem("hatchPendingFileMaterial");
    const summary = document.getElementById("fileSummary");
    if (summary) {
      summary.textContent = nextFiles.length ? `${nextFiles.length} file${nextFiles.length === 1 ? "" : "s"} attached for preview.` : "";
      summary.classList.toggle("show", nextFiles.length > 0);
    }
    input.value = "";
    syncFilesIntoBrief(nextFiles);
    renderFilePreviews();
    updateLiveTaskPreview();
    if (currentRoute() === "task-review") render();
  }

  function completeReferenceFiles() {
    const files = readJson("skillnestDraftFiles", []);
    if (!files.length) return;
    syncFilesIntoBrief(files, { completeReferences: true });
    render();
  }

  function removeDraftFile(index) {
    const files = readJson("skillnestDraftFiles", []);
    const removed = files[index];
    const url = removed?.sessionId ? fileObjectUrls.get(removed.sessionId) : removed?.objectUrl;
    if (url && url.startsWith("blob:")) URL.revokeObjectURL(url); // data: URLs need no revocation
    if (removed?.sessionId) fileObjectUrls.delete(removed.sessionId);
    files.splice(index, 1);
    localStorage.setItem("skillnestDraftFiles", JSON.stringify(files));
    const summary = document.getElementById("fileSummary");
    if (summary) {
      summary.textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} attached for preview.` : "";
      summary.classList.toggle("show", files.length > 0);
    }
    renderFilePreviews();
    updateLiveTaskPreview();
    if (currentRoute() === "task-review") {
      syncFilesIntoBrief(files);
      render();
    }
  }

  function openHatchReview() {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    setRoute("hatch-review");
  }

  function reviewedBriefToPostedTask(brief) {
    const files = readJson("skillnestDraftFiles", []);
    const industry = brief.industry || brief.businessType || "General";
    return {
      id: `hatch-${Date.now()}`,
      // Stamp the language the client actually wrote in, sniffed from the brief
      // rather than assumed from their UI language — a Chinese-interface user
      // can still write their Hatch in English.
      language: window.HatchI18n?.detectLanguage(brief.title, brief.summary, brief.businessType) || "en",
      title: brief.title || "New Hatch",
      business: brief.businessType || industry,
      clientContext: brief.clientContext || brief.businessType || industry,
      objective: brief.summary || "Create a practical solution.",
      description: brief.summary || "",
      budget: brief.suggestedBudget || "Flexible / needs guidance",
      deadline: brief.suggestedTimeline || "Flexible",
      timeline: brief.suggestedTimeline || "Flexible",
      estimatedCompletion: brief.suggestedTimeline || "Flexible",
      industry,
      category: brief.category || industry,
      level: brief.suggestedLevel || "L1",
      status: "New Hatch",
      deliverables: brief.deliverables || [],
      scope: brief.scope || [],
      references: brief.references || [],
      constraints: brief.constraints || [],
      missingInfo: brief.missingInfo || [],
      recommendedHatcherType: brief.recommendedHatcherType || brief.suggestedLevel || "L1",
      files,
      createdAt: new Date().toISOString(),
    };
  }

  function hatchQualityIssues(brief = {}) {
    const genericTitles = new Set(["content", "website", "presentation", "research", "operations", "design", "writing", "admin", "new hatch", "new project", "untitled hatch"]);
    const issues = [];
    const title = String(brief.title || "").trim();
    const objective = String(brief.summary || "").trim();
    const business = String(brief.businessType || brief.industry || "").trim();
    const deliverables = Array.isArray(brief.deliverables) ? brief.deliverables.filter(Boolean) : [];
    const scope = Array.isArray(brief.scope) ? brief.scope.filter(Boolean) : [];
    const budget = String(brief.suggestedBudget || "").trim();
    const timeline = String(brief.suggestedTimeline || "").trim();

    if (!title || genericTitles.has(title.toLowerCase()) || title.length < 12) issues.push("specific title");
    if (!objective || /practical hatch|practical project|usable result|ready for a hatcher/i.test(objective) || objective.length < 30) issues.push("useful objective");
    if (!business || /general business|to be confirmed|client$/i.test(business)) issues.push("clear business context");
    if (deliverables.length < 2 || deliverables.some((item) => /first usable version|clear delivery notes|editable final files/i.test(item))) issues.push("concrete deliverables");
    if (scope.length < 2 || scope.some((item) => /review (the )?client brief|organize work|prepare final handoff notes/i.test(item))) issues.push("task-specific scope");
    if (!budget) issues.push("budget");
    if (!timeline) issues.push("timeline");
    return issues;
  }

  function qualityGateMessage(issues = []) {
    const first = issues[0] || "one more detail";
    const labels = {
      "specific title": "what exactly the Hatcher should deliver",
      "useful objective": "the outcome you want",
      "clear business context": "who this is for",
      "concrete deliverables": "what should be handed back",
      "task-specific scope": "what work should be included",
      budget: "the rough budget",
      timeline: "the timeline",
    };
    return `I want this Hatch to be clear enough for a Hatcher to start without guessing. The next thing I need is ${labels[first] || first}.`;
  }

  function submitReviewedHatch() {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const qualityIssues = hatchQualityIssues(brief);
    const inFinalReview = brief.stage === "ready_to_post"
      || Number(localStorage.getItem("hatchActiveSectionIndex") || 0) >= briefSectionIds().length;
    if (qualityIssues.length && !inFinalReview) {
      const message = qualityGateMessage(qualityIssues);
      localStorage.setItem("hatchActiveSectionIndex", String(Math.max(0, briefSectionIds().findIndex((id) => {
        if (qualityIssues.includes("specific title")) return id === "title";
        if (qualityIssues.includes("useful objective")) return id === "summary";
        if (qualityIssues.includes("clear business context")) return id === "businessType" || id === "industry";
        if (qualityIssues.includes("concrete deliverables")) return id === "deliverables";
        if (qualityIssues.includes("task-specific scope")) return id === "deliverables";
        if (qualityIssues.includes("budget")) return id === "suggestedBudget";
        if (qualityIssues.includes("timeline")) return id === "suggestedTimeline";
        return false;
      }))));
      saveAssistantMessages([...getAssistantMessages(), ...assistantMessageEntries(message)]);
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify({
        ...brief,
        missingInfo: [...new Set([...(brief.missingInfo || []), ...qualityIssues])],
        stage: "clarifying_missing_info",
        readiness: "Almost Ready",
        nextQuestion: { key: qualityIssues[0], prompt: message, suggestions: [], placeholder: "Reply to Hatch" },
      }));
      // The follow-up question lives in the chat; leave the review page if
      // that's where the submit came from.
      if (currentRoute() === "task-review") render();
      else setRoute("task-review");
      return;
    }
    if (!isLoggedIn()) {
      localStorage.setItem("hatchPendingSubmit", "true");
      localStorage.setItem("hatchAuthReturn", "submit-reviewed-hatch");
      setRoute("auth");
      return;
    }

    const postedTask = reviewedBriefToPostedTask(brief);
    if (!saveListItem(postedTasksKey(), postedTask, "id")) {
      window.alert("The attached files are too large to submit together. Remove one and try again.");
      return;
    }
    // Mirror to the backend so it exists server-side (admin can manage it,
    // lifecycle updates reach inboxes, and the attached files are actually
    // stored — not just held in this browser tab).
    if (backendToken()) {
      backendFetch("/api/hatches", { method: "POST", body: postedTask }).then((result) => {
        if (!result?.ok) return;
        saveListItem(postedTasksKey(), { ...postedTask, backendId: result.hatch.id }, "id");
      });
    }
    localStorage.setItem("hatchProfileNotice", "Your Hatch has been submitted.");
    localStorage.setItem("hatchBrowseNotice", "Your Hatch has been submitted and is now listed here.");
    localStorage.removeItem("hatchPendingSubmit");
    localStorage.removeItem("hatchAuthReturn");
    localStorage.removeItem("hatchFinalReviewDismissed");
    clearTaskDraft({ redirect: false });
    setRoute("browse");
  }

  function saveHatchDraft() {
    localStorage.setItem("hatchDraftSavedAt", new Date().toISOString());
    saveAssistantMessages([...getAssistantMessages(), ...assistantMessageEntries("Draft saved. You can come back and finish it later.")]);
    render();
  }

  function continueChattingFromFinal() {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    localStorage.setItem("hatchFinalReviewDismissed", "true");
    localStorage.setItem("hatchShowFinalEditSections", "false");
    setActiveSectionIndex(Math.max(0, briefSectionIds().length - 1));
    const nextBrief = {
      ...brief,
      stage: "clarifying_missing_info",
      readiness: "Almost Ready",
      canSubmit: false,
      nextQuestion: {
        key: "review",
        prompt: "What would you like to adjust before submitting?",
        suggestions: [],
        placeholder: "Tell Hatch what to refine",
      },
      assistantMessage: "No problem. Tell me what you’d like to change, and I’ll update the brief.",
    };
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    saveAssistantMessages([...getAssistantMessages(), ...assistantMessageEntries(nextBrief.assistantMessage)]);
    // May be invoked from the hatch-review page; same-hash setRoute won't fire
    // a hashchange render, so render in place when already on the chat.
    if (currentRoute() === "task-review") render();
    else setRoute("task-review");
  }

  function toggleFinalEditList() {
    const current = localStorage.getItem("hatchShowFinalEditSections") === "true";
    localStorage.setItem("hatchShowFinalEditSections", current ? "false" : "true");
    render();
  }

  function editFinalSection(sectionId) {
    localStorage.removeItem("hatchFinalReviewDismissed");
    localStorage.setItem("hatchReturnToFinalReview", "true");
    localStorage.setItem("hatchShowFinalEditSections", "false");
    editSection(sectionId);
    // The focused section editor lives on the chat page.
    if (currentRoute() !== "task-review") setRoute("task-review");
  }

  function clearTaskDraft(options = {}) {
    localStorage.removeItem("skillnestDraftTask");
    localStorage.removeItem("skillnestDraftFiles");
    localStorage.removeItem("skillnestGeneratedBrief");
    localStorage.removeItem("hatchAssistantMessages");
    localStorage.removeItem("hatchActiveSectionIndex");
    localStorage.removeItem("hatchCompletedSections");
    localStorage.removeItem("hatchSectionMessages");
    localStorage.removeItem("hatchBriefEditKey");
    localStorage.removeItem("hatchAnsweredTurnIds");
    localStorage.removeItem("hatchShowFinalEditSections");
    localStorage.removeItem("hatchReturnToFinalReview");
    localStorage.removeItem("hatchFinalReviewDismissed");
    localStorage.removeItem("hatchTypedCount");
    localStorage.removeItem("hatchAssistantThinking");
    localStorage.removeItem("hatchDraftSavedAt");
    // Debug/connection state from the old conversation, so the AI panel and
    // fallback banner don't show stale info until the new conversation's
    // first response lands.
    localStorage.removeItem("hatchAiControllerState");
    localStorage.removeItem("hatchAiLastError");
    localStorage.removeItem("hatchAiIntakeMode");
    if (options.redirect !== false) setRoute(options.route || "home");
  }

  // Entry point for every "New Hatch" / "Post a Hatch" / "Start a Hatch" link.
  // A conversation you don't submit is never cleared on its own — abandoning
  // it (navigating to browse, profile, home) leaves the draft text, files,
  // brief, and chat history sitting in localStorage indefinitely. Without this,
  // the next "new" Hatch silently resumes that leftover conversation instead
  // of starting blank. Saving progress is a separate, explicit action (the
  // "Save draft" button already in the chat) — starting new always resets.
  function startNewHatch() {
    clearTaskDraft({ redirect: false });
    if (currentRoute() === "create-hatch") render();
    else setRoute("create-hatch");
  }

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
      window.setTimeout(() => messageHatcher(pendingMessageTo), 60);
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
    const account = {
      username: document.getElementById("authUsername").value.trim(),
      name: document.getElementById("authName").value.trim(),
      email: document.getElementById("authEmail").value.trim(),
      password: document.getElementById("authPassword").value,
      role: document.getElementById("authRole").value,
      joinedAt: new Date().toISOString(),
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
      username: "test_hatcher",
      name: "Test Hatcher",
      email: "test@hatch.local",
      password: "test",
      role: "Client and Hatcher",
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

  // Same search/filter/sort shape as applyTaskFilters, over the Hatcher
  // directory grid instead of the Hatch grid.
  function applyHatcherFilters() {
    const query = (document.getElementById("hatcherSearch")?.value || "").toLowerCase();
    const levels = [...document.querySelectorAll(".hatcher-level-check:checked")].map((el) => el.value);
    const industry = document.getElementById("hatcherIndustryFilter")?.value || "";
    const sort = document.getElementById("hatcherSortFilter")?.value || "";
    const grid = document.getElementById("hatcherDirectoryGrid");
    if (!grid) return;
    const cards = [...grid.querySelectorAll(".hatcher-row-card")];

    cards.forEach((card, index) => {
      if (card.dataset.order === undefined) card.dataset.order = String(index);
    });

    // Rating/completed/on-time/recommended sort high-to-low (best first);
    // level sorts low-to-high (L1 before L3), matching the Hatch level sort.
    // "Recommended" (the default, empty sort value) ranks by the blended
    // match score stamped on each card by hatcherMatchScore().
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

    document.getElementById("emptyHatchers")?.classList.toggle("show", visibleCount === 0);
    const hint = document.getElementById("hatcherResultHint");
    if (hint) hint.textContent = `${visibleCount} ${visibleCount === 1 ? "Hatcher" : "Hatchers"}`;
  }

  function resetHatcherFilters() {
    const search = document.getElementById("hatcherSearch");
    if (search) search.value = "";
    const industry = document.getElementById("hatcherIndustryFilter");
    if (industry) industry.value = "";
    const sort = document.getElementById("hatcherSortFilter");
    if (sort) sort.value = "";
    document.querySelectorAll(".hatcher-level-check:checked").forEach((el) => { el.checked = false; });
    applyHatcherFilters();
  }

  // Login-gated compose entry point for the Hatcher directory: the row card's
  // quick "Message" button and the expanded profile modal both funnel here. A
  // logged-out visitor is sent to auth first (mirroring submitReviewedHatch's
  // pending-action pattern) instead of hitting a doomed 401.
  function messageHatcher(operatorId) {
    if (!isLoggedIn() || !backendToken()) {
      localStorage.setItem("hatchPendingMessageTo", operatorId);
      setRoute("auth");
      return;
    }
    openNewMessage(operatorId, "", "");
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
    // the deliverable the Hatcher submits later actually reaches the poster. If
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
      feedback.textContent = applying ? "Hatch added to your Hatcher Hatches." : "Hatch saved to your profile.";
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
        ? "Hatch added to your Hatcher Hatches."
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

  // --- Work submission (Hatcher) and review (poster) ---------------------
  // The Hatcher describes the deliverable, optionally attaching files and
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

    // Local bridge back to the Hatcher's copy so their mission reflects the
    // decision (Hatched on approve, back to Incubating to revise on reject).
    // Only matches when the same account is testing both sides (see submitWork).
    const missions = getMissions();
    const missionIndex = missions.findIndex((mission) => mission.id === task.id || (task.backendId && mission.backendId === task.backendId));
    if (missionIndex !== -1) {
      missions[missionIndex] = { ...missions[missionIndex], status: approving ? "Hatched" : "Incubating", submission: reviewedSubmission, updatedAt: new Date().toISOString() };
      localStorage.setItem(missionsKey(), JSON.stringify(missions));
    }

    localStorage.setItem("hatchProfileNotice", approving
      ? "Submission approved. This Hatch is now Hatched."
      : "Changes requested. The Hatcher has been asked to revise.");
    closeModal();
    refreshConversations();
    render();
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
  function updateHatcherApplication() {
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
      role: sameEmail && existing.role ? existing.role : "Hatcher",
      provider: "Email",
      joinedAt: sameEmail && existing.joinedAt ? existing.joinedAt : new Date().toISOString(),
    };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    localStorage.setItem("skillnestLoggedIn", "true");
    saveOperatorWizard("about", getOperatorWizard().draft);
    render();
  }

  function operatorGoogleSignup() {
    const existing = getAccount();
    const account = existing.email
      ? { ...existing, provider: "Google (simulated)" }
      : {
        username: "google_hatcher",
        name: "",
        email: "hatcher@gmail.com",
        password: "",
        role: "Hatcher",
        provider: "Google (simulated)",
        joinedAt: new Date().toISOString(),
      };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    localStorage.setItem("skillnestLoggedIn", "true");
    saveOperatorWizard("about", getOperatorWizard().draft);
    render();
  }

  function operatorContinueLoggedIn() {
    saveOperatorWizard("about", getOperatorWizard().draft);
    render();
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

  // "Message client / Message Hatcher" on profile rows: the server resolves
  // the other party from the hatch, so no local knowledge of who claimed it
  // is needed.
  function openNewMessageForHatch(backendId) {
    const known = [...getPostedTasks(), ...getMissions()].find((item) => item.backendId === backendId);
    openNewMessage("", backendId, known?.title || "");
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

  function openVerifiedProject(workId) {
    const work = completedHatches.find((item) => item.id === workId);
    if (work) openModal(C.verifiedProjectDetail(work));
  }

  function openVerifiedHatcherProfile(profileId) {
    const profile = hatcherProfiles.find((item) => item.id === profileId);
    if (profile) openModal(C.verifiedHatcherProfile(profile));
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
    const work = completedHatches.find((item) => item.id === workId);
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
    console.info("[Hatch AI] DeepSeek connection test", result);
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
      : route === "hatchers"
        ? Pages.findHatchersPage(operators, hatcherRecommendationContext())
      : route === "verified-work"
        ? Pages.verifiedWorkPage()
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

    document.getElementById("app").innerHTML = `<div class="app-shell">${C.nav(route, isLoggedIn(), account)}<div class="page-enter">${page}</div>${C.footer(isLoggedIn(), account)}</div>`;
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
      if (route === "hatchers") applyHatcherFilters();
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
    applyDarkModePreference,
    applyTaskFilters,
    applyHatcherFilters,
    handleRangeInput,
    resetTaskFilters,
    resetHatcherFilters,
    messageHatcher,
    answerClarification,
    clearTaskDraft,
    closeModal,
    completeLogin,
    completeReferenceFiles,
    completeSignup,
    confirmSection,
    continueChattingFromFinal,
    addCustomChoice,
    attachReferenceMaterial,
    attachComposeFile,
    cancelBriefEdit,
    deletePostedTask,
    editBriefField,
    editFinalSection,
    editSection,
    downloadDraftFile,
    downloadTaskFile,
    handleTaskFiles,
    handleAssistantReplyKey,
    handleAssistantTurn,
    logout,
    finishOperatorWizard,
    operatorAccountStep,
    operatorContinueLoggedIn,
    operatorGoogleSignup,
    operatorStepBack,
    operatorStepNext,
    updateHatcherApplication,
    attachResume,
    removeResume,
    openHatchReview,
    openOperatorProfile,
    openTaskDetail,
    openVerifiedHatcherProfile,
    openVerifiedProject,
    pauseVoiceInput,
    previewDraftFile,
    previewTaskFile,
    quickTestLogin,
    removeMission,
    openSubmitWork,
    handleSubmissionFiles,
    removeSubmissionFile,
    submitWork,
    openReviewWork,
    reviewWork,
    removeCustomChoice,
    removeDraftFile,
    removePostedTaskFile,
    render,
    refreshBackendAccount,
    openConversation,
    closeThread,
    setMessagesFilter,
    sendChatMessage,
    openNewMessage,
    openNewMessageForTask,
    openNewMessageForHatch,
    sendNewMessage,
    archiveConversation,
    toggleProfileMenu,
    toggleLanguageMenu,
    toggleBrowseMenu,
    chooseLanguage,
    chooseInitialLanguage,
    dismissLanguageGate,
    showLanguageGate,
    setContentLanguage,
    setForeignHatchHandling,
    toggleTaskOriginal,
    syncContentPrefsFromAccount,
    toggleDarkModeFromMenu,
    handleAvatarFile,
    removeAvatar,
    saveAccountSettings,
    adminReviewApplication,
    adminDeleteHatch,
    adminSendMessage,
    saveMission,
    saveHatchDraft,
    setRoute,
    shareVerifiedWork,
    showOperatorTab,
    simulateVoiceInput,
    socialLogin,
    startNewHatch,
    startTaskFlow,
    submitOperator,
    submitReviewedHatch,
    sendAssistantReply,
    testDeepSeekConnection,
    moveToNextSection,
    deleteVoiceTranscript,
    rewriteSection,
    stopVoiceInput,
    toggleChoice,
    toggleDarkMode,
    toggleFinalEditList,
    toggleVoiceInput,
    updateDraftFileLabel,
    updateBriefField,
    updateLiveTaskPreview,
    updateSection,
    useExampleTask,
    useTaskChip,
  };
})();

SkillNestApp.applyDarkModePreference();
SkillNestApp.syncContentPrefsFromAccount();
SkillNestApp.render();
SkillNestApp.showLanguageGate();
// Pick up server-side account changes (role upgrades, admin flag) at boot.
window.setTimeout(() => SkillNestApp.refreshBackendAccount(), 300);
window.testDeepSeekConnection = SkillNestApp.testDeepSeekConnection;
