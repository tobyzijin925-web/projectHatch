// Split out of app.js: the hatchApi.js HTTP client, session storage, and
// per-account local task/mission storage that everything else in the app
// builds on. Depends on components/* (already loaded) and app/theme-language.js
// (not directly, but loads after it for consistent ordering). clearMessagingState
// and render are still defined in the app.js trunk, which loads after this
// file, so they're looked up on window.SkillNestApp at call time. fileObjectUrls
// is a shared Map still declared in the trunk (it's mutated by the intake
// file-attachment functions that haven't moved yet) — read via
// window.SkillNestApp.fileObjectUrls, exported as a plain property so every
// file that needs it shares the same Map instance.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { tasks } = window.SkillNestData;
  const C = window.SkillNestComponents;

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  // ── Backend client ─────────────────────────────────────────────────────────
  // The sync backend (hatchApi.js) holds accounts, operator applications, and
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
    window.SkillNestApp.clearMessagingState();
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
      window.SkillNestApp.render();
    }
  }

  function getAccount() {
    const account = readJson("skillnestAccount", {});
    // Normalize legacy role labels to the current "Operator" wording so older
    // stored accounts (and backend rows) display and route correctly. "Hatcher"
    // was the previous term; "AI Builder" the one before that.
    if (account.role === "AI Builder" || account.role === "Hatcher") return { ...account, role: "Operator" };
    if (account.role === "Client and AI Builder" || account.role === "Client and Hatcher") return { ...account, role: "Client and Operator" };
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
      const fileObjectUrls = window.SkillNestApp.fileObjectUrls;
      return fileObjectUrls.has(key) ? { ...metadata, objectUrl: fileObjectUrls.get(key) } : metadata;
    });
  }

  function marketplaceTasks() {
    const posted = getPostedTasks().map((task) => {
      const industry = task.industry || task.category || "General";
      const category = task.category || industry;
      const rawObjective = task.objective || task.description || task.summary || "";
      const genericObjective = /ready for an operator to review|clear hatch brief/i.test(rawObjective);
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
      // Carried through so the browse card can show "Posted … ago". The backend
      // sets this (toClientHatch) — older payloads may omit it.
      createdAt: hatch.createdAt || hatch.created_at || null,
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

  return {
    readJson,
    backendUrl,
    backendToken,
    backendFetch,
    storeBackendSession,
    backendPassword,
    refreshBackendAccount,
    getAccount,
    accountScopeId,
    scopedKey,
    migrateLegacyKey,
    postedTasksKey,
    missionsKey,
    getMissions,
    getPostedTasks,
    hydrateSessionFiles,
    marketplaceTasks,
    getRemoteOpenHatches,
    normalizeRemoteHatch,
    browsableTasks,
    getOperatorApplications,
    isLoggedIn,
  };
})());
