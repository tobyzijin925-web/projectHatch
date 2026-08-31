// Split out of app.js: routing helpers, dark mode, and the language menu /
// gate / content-language preferences. Loaded as a plain classic script (not
// a module, to preserve the existing synchronous script-load order) that
// contributes to the shared window.SkillNestApp object. A handful of calls
// here (closeModal, findAnyTask, getAccount, openModal, render) are still
// defined in the app.js trunk, which loads after this file, so they're
// looked up on window.SkillNestApp at call time instead of being
// destructured at this file's own load time.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const C = window.SkillNestComponents;

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
    window.SkillNestApp.render();
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
    window.SkillNestApp.openModal(C.languageGateModal());
  }

  function chooseInitialLanguage(code) {
    markLanguageGateSeen();
    window.HatchI18n?.setLang(code);
    window.SkillNestApp.closeModal();
    window.SkillNestApp.render();
  }

  function dismissLanguageGate() {
    markLanguageGateSeen();
    window.SkillNestApp.closeModal();
  }

  // Content-language preferences live in one place (HatchI18n) and are mirrored
  // onto the account so they survive a backend account refresh. The browse
  // sidebar and the settings page both drive these same two setters, which is
  // what keeps the filter and the account setting from drifting apart.
  function persistContentPrefs(prefs) {
    const account = window.SkillNestApp.getAccount();
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
    window.SkillNestApp.render();
  }

  function setForeignHatchHandling(mode) {
    const prefs = window.HatchI18n?.setPrefs({ foreignHatches: mode });
    if (!prefs) return;
    persistContentPrefs(prefs);
    window.SkillNestApp.render();
  }

  // Restore saved preferences onto a freshly-loaded account (new browser, or a
  // backend session that just replaced the local copy).
  function syncContentPrefsFromAccount() {
    const account = window.SkillNestApp.getAccount();
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
      const task = window.SkillNestApp.findAnyTask(card.dataset.taskId);
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

  return {
    currentRoute,
    setRoute,
    applyDarkModePreference,
    toggleDarkMode,
    toggleLanguageMenu,
    closeLanguageMenu,
    toggleBrowseMenu,
    closeBrowseMenu,
    chooseLanguage,
    showLanguageGate,
    chooseInitialLanguage,
    dismissLanguageGate,
    setContentLanguage,
    setForeignHatchHandling,
    syncContentPrefsFromAccount,
    hydrateTaskTranslations,
    toggleTaskOriginal,
  };
})());
