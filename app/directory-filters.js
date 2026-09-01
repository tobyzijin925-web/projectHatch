// Split out of app.js: choice-pill controls, the search/filter/sort logic
// for the browse/operator/client directory grids, and the login-gated
// "Message" entry points from those directories. Depends on
// app/theme-language.js and app/backend-client.js (loaded earlier).
// openModal and openNewMessage are still defined later in the app.js trunk,
// so those two calls go through window.SkillNestApp.foo() instead of a
// destructure.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { clients } = window.SkillNestData;
  const C = window.SkillNestComponents;
  const { setRoute, hydrateTaskTranslations, backendToken, isLoggedIn } = window.SkillNestApp;

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
    window.SkillNestApp.openNewMessage(operatorId, "", "");
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
    window.SkillNestApp.openNewMessage(clientId, "", "");
  }

  function openClientProfile(clientId) {
    const client = clients.find((item) => item.id === clientId);
    if (client) window.SkillNestApp.openModal(C.clientDetail(client));
  }

  // No task context to match against when an Operator browses clients (that
  // matching runs the other direction), so the recommended row just falls
  // back to top-rated. Kept as a seam mirroring operatorRecommendationContext.
  function clientRecommendationContext() {
    return {};
  }

  return {
    toggleChoice,
    addCustomChoice,
    removeCustomChoice,
    applyTaskFilters,
    handleRangeInput,
    resetTaskFilters,
    applyOperatorFilters,
    resetOperatorFilters,
    messageOperator,
    applyClientFilters,
    resetClientFilters,
    messageClient,
    openClientProfile,
    clientRecommendationContext,
  };
})());
