window.SkillNestPages = (() => {
  const { tasks, operators, clients, levels, completedHatches } = window.SkillNestData;
  const C = window.SkillNestComponents;

  function socialAuthButtons() {
    return `
      <div class="social-auth" aria-label="Social sign in options">
        <button class="social-btn demo-only" type="button" disabled>Google login demo only</button>
        <button class="social-btn demo-only" type="button" disabled>Microsoft login demo only</button>
        <button class="social-btn demo-only" type="button" disabled>Apple login demo only</button>
      </div>
    `;
  }

  function homePage(draftText = "", files = []) {
    return `
      <main>
        ${C.hero(draftText, files)}
        ${C.messagingFeatureSection()}
        ${C.whyHatchSection()}
        ${C.recentVerifiedWorkSection()}
        ${C.hatchLifecycleSection()}
        ${C.recentlyHatchedSection()}
      </main>
    `;
  }

  function taskReviewPage(draftTask, files, generatedBrief, assistantMessages = []) {
    const brief = generatedBrief || C.generateTaskBrief(draftTask, files);
    const readiness = String(brief.readiness || brief.stage || "").toLowerCase();
    const missingInfo = Array.isArray(brief.missingInfo) ? brief.missingInfo.filter(Boolean) : [];
    const ready = Number(localStorage.getItem("hatchActiveSectionIndex") || 0) >= 9
      || /ready_to_post|ready to post/.test(readiness)
      || brief.canSubmit === true
      || (brief.isValidProject && missingInfo.length === 0);
    const intakeMode = localStorage.getItem("hatchAiIntakeMode");
    const intakeLabel = intakeMode === "connected"
      ? "AI intake connected"
      : intakeMode === "local-validation"
        ? "Still shaping the idea"
        : intakeMode === "local-fallback"
          ? "Local intake fallback"
          : "Checking AI connection...";
    const aiError = localStorage.getItem("hatchAiLastError") || "";
    return `
      <main class="section page">
        <div class="review-layout project-builder-layout">
          <div class="form-copy">
            <h1>Describe it naturally.</h1>
            <p>Hatch will organize the brief while you talk through the work.</p>
            <span class="intake-mode ${aiError ? "warning" : ""}">${intakeLabel}${aiError ? ` · ${C.escapeHtml(aiError)}` : ""}</span>
            ${C.assistantConversationMarkup(assistantMessages, brief)}
          </div>
          <section class="review-card">
            <div class="card-title-row">
              <h2>Live understanding</h2>
              <span class="tag">${ready ? "Ready" : "In progress"}</span>
            </div>
            ${C.taskReviewBriefMarkup(brief, files)}
          </section>
        </div>
      </main>
    `;
  }

  function hatchReviewPage(files = [], generatedBrief = null) {
    if (!generatedBrief?.ok) {
      return `
        <main class="section page">
          <div class="hatch-review-empty">
            <h1>Nothing to review yet.</h1>
            <p>Describe your Hatch first — once it’s shaped, you can review and post it here.</p>
            <a class="btn primary" href="#create-hatch" onclick="SkillNestApp.startNewHatch()">Start a Hatch</a>
          </div>
        </main>
      `;
    }
    return `
      <main class="section page">
        <div class="hatch-review-layout">
          <div class="form-copy hatch-review-head">
            <span class="section-label">Final review</span>
            <h1>Review your Hatch.</h1>
            <p>This is exactly what Operators will see. Check it once, then post it so they can take the work.</p>
          </div>
          <section class="review-card hatch-review-card">
            ${C.finalReviewMarkup(generatedBrief, files, [])}
          </section>
        </div>
      </main>
    `;
  }

  function fileLabel(file) {
    if (typeof file === "string") return C.escapeHtml(file);
    const size = file.size ? `${Math.ceil(file.size / 1024)} KB` : "Size unavailable";
    return `${C.escapeHtml(file.name)} (${C.escapeHtml(file.type || "file")} · ${size})`;
  }

  // Language controls in the browse sidebar are a view onto the account's
  // content-language preference, not a separate per-page filter — changing
  // either one here writes straight back to the account, so the two stay in
  // sync. Counts are shown so it is obvious what hiding a language costs.
  function languageFilterMarkup(allTasks = []) {
    const I18n = window.HatchI18n;
    if (!I18n) return "";
    const { contentLanguage, foreignHatches } = I18n.getPrefs();
    const counts = allTasks.reduce((acc, task) => {
      const code = I18n.taskLanguage(task);
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});
    const foreignCount = allTasks.length - (counts[contentLanguage] || 0);

    // Counts are kept out of the label text: an interpolated number would make
    // the string a unique key the dictionary can never match, so it renders as
    // a sibling node instead.
    const options = [
      ["translate", "Translate into my language", "Machine-translated, original always one click away", 0],
      ["original", "Show as written", "No translation — Hatches stay in their own language", 0],
      ["hide", "Hide them", "Only show Hatches already in my language", foreignCount],
    ];

    return `
      <div class="filter-group language-filter">
        <label class="filter-heading" for="contentLanguageFilter">My language</label>
        <select id="contentLanguageFilter" onchange="SkillNestApp.setContentLanguage(this.value)">
          ${I18n.languages().map((lang) => `
            <option value="${lang.code}" ${lang.code === contentLanguage ? "selected" : ""}>${C.escapeHtml(lang.native)}${counts[lang.code] ? ` (${counts[lang.code]})` : ""}</option>
          `).join("")}
        </select>
        <div class="filter-heading filter-subheading">Hatches in other languages</div>
        <div class="filter-options">
          ${options.map(([value, label, hint, count]) => `
            <label class="filter-check filter-radio">
              <input type="radio" name="foreignHatches" value="${value}" ${value === foreignHatches ? "checked" : ""} onchange="SkillNestApp.setForeignHatchHandling('${value}')" />
              <span>
                <span class="filter-radio-label">${C.escapeHtml(label)}${count ? `<span class="filter-radio-count"> (${count})</span>` : ""}</span>
                <small class="filter-radio-hint">${C.escapeHtml(hint)}</small>
              </span>
            </label>
          `).join("")}
        </div>
        <p class="filter-note">Saved to your account — this matches your Language setting.</p>
      </div>
    `;
  }

  function browsePage(allTasks = tasks) {
    const uniqueLevels = [...new Set(allTasks.map((task) => task.level).filter(Boolean))]
      .sort((a, b) => C.completionSortValue(a) - C.completionSortValue(b) || String(a).localeCompare(String(b)));
    const industries = [...new Set(allTasks.map((task) => task.industry).filter(Boolean))];
    const browseNotice = localStorage.getItem("hatchBrowseNotice") || "";

    // Range bounds from real (non-"Flexible") values so the sliders span the
    // actual catalog. Guard against a degenerate single-value range.
    const priceValues = allTasks.map((task) => C.budgetSortValue(task.budget)).filter((v) => v < Number.MAX_SAFE_INTEGER);
    const dayValues = allTasks.map((task) => C.completionSortValue(task.estimatedCompletion || task.timeline)).filter((v) => v < Number.MAX_SAFE_INTEGER);
    const priceMin = priceValues.length ? Math.floor(Math.min(...priceValues)) : 0;
    const priceMax = Math.max(priceValues.length ? Math.ceil(Math.max(...priceValues)) : 0, priceMin + 1);
    const dayMin = dayValues.length ? Math.floor(Math.min(...dayValues)) : 0;
    const dayMax = Math.max(dayValues.length ? Math.ceil(Math.max(...dayValues)) : 0, dayMin + 1);

    return `
      <main>
        <section class="section page" id="tasks">
          ${browseNotice ? `<div class="success-message show profile-notice">${C.escapeHtml(browseNotice)}</div>` : ""}
          <div class="section-head compact-head">
            <div>
              <div class="section-label">Browse Hatches</div>
              <h2>Hatches</h2>
              <p class="section-kicker">Find open, incubating, and recently hatched work.</p>
            </div>
          </div>
          <div class="browse-layout">
            <aside class="browse-sidebar" aria-label="Hatch filters">
              <div class="filter-group">
                <label class="filter-heading" for="taskSearch">Search</label>
                <input id="taskSearch" type="search" placeholder="Task, business, or industry..." oninput="SkillNestApp.applyTaskFilters()" />
              </div>
              <div class="filter-group">
                <div class="filter-heading">Level</div>
                <div class="filter-options">
                  ${uniqueLevels.map((level) => `
                    <label class="filter-check">
                      <input type="checkbox" class="level-check" value="${C.escapeHtml(level)}" onchange="SkillNestApp.applyTaskFilters()" />
                      <span>${C.escapeHtml(level)}</span>
                    </label>
                  `).join("")}
                </div>
              </div>
              <div class="filter-group">
                <div class="filter-heading">Price</div>
                ${C.rangeFilterMarkup({ id: "priceRange", min: priceMin, max: priceMax, format: "price" })}
              </div>
              <div class="filter-group">
                <div class="filter-heading">Length</div>
                ${C.rangeFilterMarkup({ id: "lengthRange", min: dayMin, max: dayMax, format: "days" })}
              </div>
              ${languageFilterMarkup(allTasks)}
              <div class="filter-group">
                <label class="filter-heading" for="industryFilter">Industry</label>
                <select id="industryFilter" onchange="SkillNestApp.applyTaskFilters()">
                  <option value="">All industries</option>
                  ${industries.map((industry) => `<option value="${C.escapeHtml(industry)}">${industry}</option>`).join("")}
                </select>
              </div>
              <button class="btn ghost small filter-reset" type="button" onclick="SkillNestApp.resetTaskFilters()">Clear filters</button>
            </aside>
            <div class="browse-main">
              <div class="browse-toolbar">
                <span class="result-hint" id="taskResultHint"></span>
                <button class="btn ghost small browse-refresh" type="button" onclick="SkillNestApp.refreshBrowse()" title="Refresh the feed" aria-label="Refresh Hatches feed">
                  <span class="browse-refresh-icon" aria-hidden="true">↻</span>
                  <span>Refresh</span>
                </button>
                <span class="browse-refresh-status" id="browseRefreshStatus" role="status" aria-live="polite"></span>
                <label class="sort-control">
                  <span>Sort by</span>
                  <select id="sortFilter" onchange="SkillNestApp.applyTaskFilters()">
                    <option value="">Featured</option>
                    <option value="time">Time: shortest first</option>
                    <option value="price">Price: low to high</option>
                    <option value="level">Level: L1 → L3</option>
                  </select>
                </label>
              </div>
              <div class="task-feedback" id="taskFeedback" role="status"></div>
              <div class="task-grid browse-grid" id="browseTaskGrid">
                ${allTasks.map((task) => C.taskCard(task, true)).join("")}
              </div>
              <div class="empty-state" id="emptyTasks">No Hatches match those filters.</div>
            </div>
          </div>
        </section>
      </main>
    `;
  }

  // Finding a person instead of a task: same browse-and-filter shape as
  // browsePage, but the grid lays each Operator out as a wide row (photo left,
  // details right) two per row, rather than a task-style tile grid — a person
  // reads better as a row than a card.
  function findOperatorsPage(allOperators = operators, context = {}) {
    const uniqueLevels = [...new Set(allOperators.map((op) => C.operatorLevelBucket(op.level)).filter(Boolean))]
      .sort((a, b) => C.levelSortValue(a) - C.levelSortValue(b));
    const industries = [...new Set(allOperators.flatMap((op) => op.industries || []))];

    return `
      <main>
        <section class="section page" id="operators">
          <div class="section-head compact-head">
            <div>
              <div class="section-label">Find Operators</div>
              <h2>Operators</h2>
              <p class="section-kicker">Browse verified Operators and message the right one directly.</p>
            </div>
          </div>
          ${C.recommendedOperators(context.industry || "", context.tools || [])}
          <div class="browse-layout">
            <aside class="browse-sidebar" aria-label="Operator filters">
              <div class="filter-group">
                <label class="filter-heading" for="operatorSearch">Search</label>
                <input id="operatorSearch" type="search" placeholder="Name, industry, or tool..." oninput="SkillNestApp.applyOperatorFilters()" />
              </div>
              <div class="filter-group">
                <div class="filter-heading">Level</div>
                <div class="filter-options">
                  ${uniqueLevels.map((level) => `
                    <label class="filter-check">
                      <input type="checkbox" class="operator-level-check" value="${C.escapeHtml(level)}" onchange="SkillNestApp.applyOperatorFilters()" />
                      <span>${C.escapeHtml(level)}</span>
                    </label>
                  `).join("")}
                </div>
              </div>
              <div class="filter-group">
                <label class="filter-heading" for="operatorIndustryFilter">Industry</label>
                <select id="operatorIndustryFilter" onchange="SkillNestApp.applyOperatorFilters()">
                  <option value="">All industries</option>
                  ${industries.map((industry) => `<option value="${C.escapeHtml(industry)}">${industry}</option>`).join("")}
                </select>
              </div>
              <button class="btn ghost small filter-reset" type="button" onclick="SkillNestApp.resetOperatorFilters()">Clear filters</button>
            </aside>
            <div class="browse-main">
              <div class="browse-toolbar">
                <span class="result-hint" id="operatorResultHint"></span>
                <label class="sort-control">
                  <span>Sort by</span>
                  <select id="operatorSortFilter" onchange="SkillNestApp.applyOperatorFilters()">
                    <option value="">Recommended</option>
                    <option value="rating">Rating: high to low</option>
                    <option value="completed">Most Hatched</option>
                    <option value="ontime">On-time: high to low</option>
                    <option value="level">Level: L1 → L3</option>
                  </select>
                </label>
              </div>
              <div class="operator-directory-grid" id="operatorDirectoryGrid">
                ${allOperators.map((operator) => C.operatorDirectoryCard(operator, context)).join("")}
              </div>
              <div class="empty-state" id="emptyOperators">No Operators match those filters.</div>
            </div>
          </div>
        </section>
      </main>
    `;
  }

  // Browse clients: the mirror image of findOperatorsPage — same browse-and-
  // filter layout and the same wide-row directory grid, but listing the
  // businesses posting Hatches so an Operator can find and contact the right one.
  function findClientsPage(allClients = clients, context = {}) {
    const types = [...new Set(allClients.map((client) => client.type).filter(Boolean))];
    const industries = [...new Set(allClients.flatMap((client) => client.industries || []))];

    return `
      <main>
        <section class="section page" id="clients">
          <div class="section-head compact-head">
            <div>
              <div class="section-label">Browse Clients</div>
              <h2>Clients</h2>
              <p class="section-kicker">Browse the businesses posting Hatches and message the right one directly.</p>
            </div>
          </div>
          ${C.recommendedClients(context.industry || "", context.tools || [])}
          <div class="browse-layout">
            <aside class="browse-sidebar" aria-label="Client filters">
              <div class="filter-group">
                <label class="filter-heading" for="clientSearch">Search</label>
                <input id="clientSearch" type="search" placeholder="Name, industry, or tool..." oninput="SkillNestApp.applyClientFilters()" />
              </div>
              <div class="filter-group">
                <div class="filter-heading">Business type</div>
                <div class="filter-options">
                  ${types.map((type) => `
                    <label class="filter-check">
                      <input type="checkbox" class="client-type-check" value="${C.escapeHtml(type)}" onchange="SkillNestApp.applyClientFilters()" />
                      <span>${C.escapeHtml(type)}</span>
                    </label>
                  `).join("")}
                </div>
              </div>
              <div class="filter-group">
                <label class="filter-heading" for="clientIndustryFilter">Industry</label>
                <select id="clientIndustryFilter" onchange="SkillNestApp.applyClientFilters()">
                  <option value="">All industries</option>
                  ${industries.map((industry) => `<option value="${C.escapeHtml(industry)}">${industry}</option>`).join("")}
                </select>
              </div>
              <button class="btn ghost small filter-reset" type="button" onclick="SkillNestApp.resetClientFilters()">Clear filters</button>
            </aside>
            <div class="browse-main">
              <div class="browse-toolbar">
                <span class="result-hint" id="clientResultHint"></span>
                <label class="sort-control">
                  <span>Sort by</span>
                  <select id="clientSortFilter" onchange="SkillNestApp.applyClientFilters()">
                    <option value="">Recommended</option>
                    <option value="rating">Rating: high to low</option>
                    <option value="posted">Most posted</option>
                    <option value="hire">Hire rate: high to low</option>
                  </select>
                </label>
              </div>
              <div class="operator-directory-grid" id="clientDirectoryGrid">
                ${allClients.map((client) => C.clientDirectoryCard(client, context)).join("")}
              </div>
              <div class="empty-state" id="emptyClients">No clients match those filters.</div>
            </div>
          </div>
        </section>
      </main>
    `;
  }

  function verifiedWorkPage(publishedResults = []) {
    // Client-published results (from real, approved reviews) sit alongside the
    // seeded demo Hatches; both share the same card and sort newest-first.
    const orderedWork = [...publishedResults, ...completedHatches]
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    return `
      <main>
        <section class="section page page-intro verified-work-intro">
          <div class="section-label">Verified Results</div>
          <h1>Completed Hatches, verified delivery.</h1>
          <p class="section-kicker">A simple record of finished work, who completed it, what was delivered, and how the task performed.</p>
        </section>
        <section class="section page verified-work-page">
          <div class="verified-work-feed">
            ${orderedWork.map((work) => C.verifiedWorkCard(work)).join("")}
          </div>
        </section>
      </main>
    `;
  }

  function authPage() {
    return `
      <main class="section page auth-page">
        <div class="auth-layout">
          <div class="form-copy">
            <div class="section-label">Log in</div>
            <h1>Log in to Hatch.</h1>
            <p>Use your username or email to continue to your Hatch dashboard.</p>
          </div>
          <form class="form-card auth-card" onsubmit="SkillNestApp.completeLogin(event)">
            ${socialAuthButtons()}
            <div class="auth-divider"><span>or use email</span></div>
            <div class="form-grid">
              ${C.field("Username or email", "loginUsername", "maya_client or you@example.com")}
              ${C.field("Password", "loginPassword", "Your password", "password")}
            </div>
            <button class="btn primary full" type="submit">Log in</button>
            <button class="btn secondary full test-login-btn" type="button" onclick="SkillNestApp.quickTestLogin()">Quick test login</button>
            <div class="success error" id="loginError">No matching local account found. Create an account first for this MVP preview.</div>
            <div class="auth-switch">
              <span>New to Hatch?</span>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.setRoute('signup')">Create an account</button>
            </div>
            <p class="form-note">MVP preview: login is simulated locally on this device. The quick login is only for testing.</p>
          </form>
        </div>
      </main>
    `;
  }

  // Asked at signup rather than left to a default, because the answer changes
  // what the catalog looks like the moment the account lands on Browse. Both
  // fields are prefilled from whatever language the visitor is already reading
  // the site in, so the common case is "leave it alone and submit".
  function signupLanguageSection() {
    const I18n = window.HatchI18n;
    if (!I18n) return "";
    const uiLang = I18n.getLang();
    const { foreignHatches } = I18n.getPrefs();

    const handlingOptions = [
      ["translate", "Translate them for me", "Recommended — you see every Hatch, in your language"],
      ["original", "Show them as written", "You read each Hatch in its original language"],
      ["hide", "Hide them", "Only Hatches already in my language"],
    ];

    return `
      <fieldset class="signup-language">
        <legend>Language</legend>
        <p class="form-note signup-language-intro">Pick the language you want to read Hatches in, and what should happen to Hatches posted in another language. You can change both later in account settings.</p>
        <label class="field">
          <span>My language</span>
          <select id="authLanguage">
            ${I18n.languages().map((lang) => `
              <option value="${lang.code}" ${lang.code === uiLang ? "selected" : ""}>${C.escapeHtml(lang.native)}</option>
            `).join("")}
          </select>
        </label>
        <div class="signup-language-handling">
          <span class="field-legend">Hatches in other languages</span>
          <div class="filter-options">
            ${handlingOptions.map(([value, label, hint]) => `
              <label class="filter-check filter-radio">
                <input type="radio" name="authForeignHatches" value="${value}" ${value === foreignHatches ? "checked" : ""} />
                <span>
                  <span class="filter-radio-label">${C.escapeHtml(label)}</span>
                  <small class="filter-radio-hint">${C.escapeHtml(hint)}</small>
                </span>
              </label>
            `).join("")}
          </div>
        </div>
      </fieldset>
    `;
  }

  function signupPage() {
    return `
      <main class="section page auth-page">
        <div class="auth-layout">
          <div class="form-copy">
            <div class="section-label">Create account</div>
            <h1>Set up your Hatch account.</h1>
            <p>Clients post Hatches. Operators hatch them.</p>
          </div>
          <form class="form-card auth-card" onsubmit="SkillNestApp.completeSignup(event)">
            ${socialAuthButtons()}
            <div class="auth-divider"><span>or create manually</span></div>
            <div class="form-grid">
              ${C.field("Username", "authUsername", "hatch_user")}
              ${C.field("Full name", "authName", "Your name")}
              ${C.field("Email", "authEmail", "you@example.com", "email")}
              ${C.field("Password", "authPassword", "Create a password", "password")}
              ${C.selectField("I am joining as", "authRole", ["Client", "Operator", "Client and Operator"])}
            </div>
            ${signupLanguageSection()}
            <label class="terms-check">
              <input type="checkbox" id="authTerms" required />
              <span>I have read and agree to Hatch's <a href="#terms" target="_blank" rel="noopener">Terms &amp; Conditions</a> and <a href="#privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span>
            </label>
            <button class="btn primary full" type="submit">Create account</button>
            <div class="auth-switch">
              <span>Already have an account?</span>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.setRoute('auth')">Log in</button>
            </div>
            <p class="form-note">MVP preview: this only simulates account access locally.</p>
          </form>
        </div>
      </main>
    `;
  }

  // The single, canonical "create a Hatch" entry point. Same AI-intake composer
  // as the homepage hero, but on a focused page — so "Post a Hatch" from the
  // profile, footer, or post-login lands the user straight in the Chickie flow
  // instead of a separate dropdown form.
  function createHatchPage(account, draftTask, files = []) {
    return `
      <main class="section page">
        <div class="create-hatch-layout">
          <div class="form-copy create-hatch-head">
            <div class="section-label">New Hatch</div>
            <h1>Start a Hatch.</h1>
            <p>Describe what you need in your own words. Chickie will organize it into a clear brief and walk you to a postable Hatch.</p>
            ${account?.email ? `
              <div class="account-note">
                <span>Posting as</span>
                <strong>${C.escapeHtml(account.name || account.username || "Your account")}</strong>
                <p>${C.escapeHtml(account.email || "")}</p>
              </div>
            ` : ""}
          </div>
          ${C.taskComposer(draftTask, files)}
        </div>
      </main>
    `;
  }

  function operatorStepper(step) {
    const steps = [
      { id: "account", label: "Account" },
      { id: "about", label: "About you" },
      { id: "focus", label: "Focus areas" },
    ];
    const activeIndex = step === "done" ? steps.length : steps.findIndex((item) => item.id === step);
    return `
      <div class="wizard-steps" aria-label="Application progress">
        ${steps.map((item, index) => {
          const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
          return `
          <div class="wizard-step ${state}">
            <span class="wizard-step-num">${index < activeIndex ? "&#10003;" : index + 1}</span>
            <span class="wizard-step-label">${item.label}</span>
          </div>
        `;
        }).join(`<span class="wizard-step-line"></span>`)}
      </div>
    `;
  }

  function operatorAccountStep(account, loggedIn) {
    const continueAs = loggedIn && account.email
      ? `
        <button class="btn primary full" type="button" onclick="SkillNestApp.operatorContinueLoggedIn()">Continue as ${C.escapeHtml(account.email)}</button>
        <div class="auth-divider"><span>or use a different account</span></div>
      `
      : "";
    return `
      <form class="form-card auth-card" onsubmit="SkillNestApp.operatorAccountStep(event)">
        ${continueAs}
        <div class="social-auth" aria-label="Social sign up options">
          <button class="social-btn google-btn" type="button" onclick="SkillNestApp.operatorGoogleSignup()">
            <span class="google-mark" aria-hidden="true">G</span> Continue with Google
          </button>
        </div>
        <div class="auth-divider"><span>or use email</span></div>
        <div class="form-grid single-column">
          ${C.field("Email", "operatorAuthEmail", "you@example.com", "email")}
          ${C.field("Password", "operatorAuthPassword", "Create a password", "password")}
        </div>
        <button class="btn primary full" type="submit">Join as an Operator</button>
        <p class="form-note">MVP preview: your account and the Google option are simulated locally on this device.</p>
      </form>
    `;
  }

  function operatorAboutStep(account, draft) {
    return `
      <form class="form-card" onsubmit="SkillNestApp.operatorStepNext(event)">
        <div class="form-grid single-column">
          ${C.field("Name", "operatorName", "Your name", "text", { value: draft.name || account.name || "" })}
          ${C.choiceField("Background", "background", ["Student", "Admin assistant", "Designer", "Marketer", "Developer", "Business owner"], "Other background", draft.background || [])}
          ${C.choiceField("Tools you use", "tools", ["ChatGPT", "Claude", "Canva", "Notion", "Zapier", "Google Sheets", "Cursor", "Midjourney"], "Other tools", draft.tools || [])}
        </div>
        <div class="wizard-actions">
          <button class="btn secondary" type="button" onclick="SkillNestApp.operatorStepBack(event)">Back</button>
          <button class="btn primary" type="submit">Continue</button>
        </div>
      </form>
    `;
  }

  function operatorFocusStep(draft) {
    const resumeName = draft.resumeName || "";
    return `
      <form class="form-card operator-focus-form" onsubmit="SkillNestApp.submitOperator(event)">
        <div class="form-grid single-column">
          ${C.choiceField("Industries you understand", "industries", ["Restaurants", "E-commerce", "Local Services", "Real Estate", "Education", "Health & wellness"], "Other industry", draft.industries || [])}
          ${C.choiceField("Example Hatches you can complete", "exampleTasks", ["Social posts", "Product descriptions", "Simple websites", "Customer reply templates", "Menus/flyers", "Spreadsheet cleanup"], "Other Hatches", draft.exampleTasks || [])}
          <label class="field full-field">
            <span>LinkedIn profile <span class="field-optional">(optional)</span></span>
            <input id="operatorLinkedin" type="url" placeholder="https://www.linkedin.com/in/you" value="${C.escapeHtml(draft.linkedin || "")}" />
          </label>
          <div class="field full-field">
            <span class="field-label">Resume <span class="field-optional">(optional &middot; PDF or Word, under 2&nbsp;MB)</span></span>
            <div class="resume-upload">
              <input id="operatorResume" class="hidden-file" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onchange="SkillNestApp.attachResume(event)" />
              <button class="btn secondary small" type="button" onclick="document.getElementById('operatorResume').click()">${resumeName ? "Replace resume" : "Upload resume"}</button>
              ${resumeName
                ? `<span class="resume-chip">${C.escapeHtml(resumeName)} <button type="button" class="remove-choice" onclick="SkillNestApp.removeResume()">x</button></span>`
                : `<span class="muted-text">No file chosen</span>`}
            </div>
          </div>
        </div>
        <div class="wizard-actions">
          <button class="btn secondary" type="button" onclick="SkillNestApp.operatorStepBack(event)">Back</button>
          <button class="btn primary" type="submit">Submit application</button>
        </div>
      </form>
    `;
  }

  function operatorDoneStep() {
    return `
      <div class="form-card wizard-success">
        <div class="wizard-success-mark" aria-hidden="true">&#10003;</div>
        <h2>Application received.</h2>
        <p>In a real version, Hatch would review your starting Hatch level. You can track your application from your profile.</p>
        <div class="wizard-actions">
          <button class="btn secondary" type="button" onclick="SkillNestApp.finishOperatorWizard('browse')">Browse Hatches</button>
          <button class="btn primary" type="button" onclick="SkillNestApp.finishOperatorWizard('profile')">View profile</button>
        </div>
      </div>
    `;
  }

  function operatorPage(account, wizard = { step: "account", draft: {} }, loggedIn = false) {
    /* Operator application wizard DISABLED — joining as an Operator is now instant.
       Selecting "Become an Operator" and setting up an account makes you an Operator
       right away; there is no about-you / focus-areas / submit / review flow.
       The multi-step application is kept here, commented out, in case it returns.
    const { step, draft } = wizard;
    const stepCopy = {
      account: "First, set up the account you’ll hatch under.",
      about: "Tell us a little about yourself and the tools you already use.",
      focus: "Pick the industries and Hatches you feel confident about.",
      done: "Application submitted.",
    };
    const stepMarkup = step === "about"
      ? operatorAboutStep(account, draft)
      : step === "focus"
        ? operatorFocusStep(draft)
        : step === "done"
          ? operatorDoneStep()
          : operatorAccountStep(account, loggedIn);
    */
    return `
      <main class="section page">
        <div class="form-layout">
          <div class="form-copy">
            <div class="section-label">Become an Operator</div>
            <h1>Join as an Operator and start building.</h1>
            <p>Set up the account you’ll hatch under — that’s it. You’re an Operator the moment you join.</p>
            <div class="operator-info">
              <h2>Growth path</h2>
              <p>L1 support Hatches -> L2 business Hatches -> L3 specialized Hatches -> L4 strategy later.</p>
              <h2>What helps</h2>
              <p>Clear communication, reliable delivery, useful tools, and familiarity with a few categories.</p>
            </div>
          </div>
          <div class="wizard-column">
            ${operatorAccountStep(account, loggedIn)}
          </div>
        </div>
      </main>
    `;
  }

  function miniTaskList(items, emptyText, options = {}) {
    if (!items.length) return `<p class="muted-text">${emptyText}</p>`;
    const removable = Boolean(options.removable);
    const type = options.type || "mission";
    const removeHandler = type === "posted" ? "deletePostedTask" : "removeMission";
    const removeLabel = type === "posted" ? "Delete" : "Remove";
    return `
      <div class="profile-list">
        ${items.map((item) => {
          const id = item.id || encodeURIComponent(item.title);
          const status = item.status || "";
          // Operator's claimed Hatches can submit work; posted Hatches with a
          // deliverable waiting can be reviewed by the poster.
          const canSubmit = type === "mission" && (status === "Incubating" || status === "Accepted");
          const awaitingReview = type === "mission" && status === "In review";
          const submissionPending = type === "posted" && item.submission && item.submission.status === "pending";
          const canReview = type === "posted" && (item.submission || (item.backendId && status !== "Hatched"));
          // Surface the review state right in the row so the Operator sees their
          // work is with the client, and the client sees work is waiting.
          const reviewNote = awaitingReview
            ? `<p class="mission-review-note reviewing">📮 Submitted — the client is reviewing your work.</p>`
            : submissionPending
              ? `<p class="mission-review-note pending">📮 A submission is waiting for your review.</p>`
              : "";
          const displayStatus = status || item.level || "Open";
          // Backend hatches have a counterpart to talk to. Posted rows always
          // get the button (the server explains if nobody claimed yet), but a
          // mission row only once the viewer actually claimed it — a merely
          // Saved hatch belongs to strangers, and the server would 403.
          const canMessage = Boolean(item.backendId)
            && (type === "posted" || ["Incubating", "Accepted", "In review", "Hatched"].includes(status));
          const messageLabel = type === "posted" ? "Message Operator" : "Message client";
          return `
          <article${awaitingReview ? ` class="is-in-review"` : ""}>
            <div>
              <h3>${C.escapeHtml(item.title)}</h3>
              <p>${C.escapeHtml(item.category || item.industry || item.business || "")} ${item.budget ? `&middot; ${C.escapeHtml(item.budget)}` : ""}</p>
              ${reviewNote}
            </div>
            <div class="mission-actions">
              ${C.statusBadge(displayStatus)}
              ${canSubmit ? `<button class="btn primary small" type="button" onclick="SkillNestApp.openSubmitWork('${id}')">Submit work</button>` : ""}
              ${awaitingReview ? `<button class="btn secondary small" type="button" onclick="SkillNestApp.openSubmitWork('${id}')">Update submission</button>` : ""}
              ${canReview ? `<button class="btn primary small" type="button" onclick="SkillNestApp.openReviewWork('${id}')">Review work</button>` : ""}
              ${canMessage ? `<button class="btn secondary small" type="button" onclick="SkillNestApp.openNewMessageForHatch('${C.escapeHtml(item.backendId)}')">${messageLabel}</button>` : ""}
              ${removable ? `<button class="btn ghost small danger" type="button" onclick="SkillNestApp.${removeHandler}('${id}')">${removeLabel}</button>` : ""}
            </div>
          </article>
        `;
        }).join("")}
      </div>
    `;
  }

  function profilePage(account, postedTasks, missions, operatorApplications = [], unreadMessages = 0, adminData = { applications: [], hatches: [] }, adminHatches = []) {
    const accepted = missions.filter((mission) => mission.status === "Incubating" || mission.status === "Accepted");
    const inReview = missions.filter((mission) => mission.status === "In review");
    const saved = missions.filter((mission) => mission.status === "Saved");
    const profileNotice = localStorage.getItem("hatchProfileNotice") || "";
    const unread = Number(unreadMessages) || 0;
    return `
      <main class="section page">
        ${profileNotice ? `<div class="success-message show profile-notice">${C.escapeHtml(profileNotice)}</div>` : ""}
        <div class="profile-hero">
          <div class="profile-hero-id">
            ${C.userAvatar(account, "avatar-xl")}
            <div>
              <div class="section-label">Profile</div>
              <h1>${C.escapeHtml(account.name || account.username || "Your profile")}</h1>
              <p>${C.escapeHtml(account.email || "")}</p>
            </div>
          </div>
          <div class="profile-actions">
            <button class="btn secondary" type="button" onclick="SkillNestApp.startNewHatch()">Post a Hatch</button>
            <button class="btn secondary" type="button" onclick="SkillNestApp.setRoute('browse')">Browse Hatches</button>
            <button class="btn secondary" type="button" onclick="SkillNestApp.setRoute('settings')">Manage account</button>
            <button class="btn ghost" type="button" onclick="SkillNestApp.logout()">Log out</button>
          </div>
        </div>
        <div class="profile-grid">
          <section class="profile-card account-card">
            <h2>Account</h2>
            <dl>
              <div><dt>Username</dt><dd>${C.escapeHtml(account.username || "-")}</dd></div>
              <div><dt>Role</dt><dd>${C.escapeHtml(account.role || "-")}</dd></div>
              <div><dt>Sign in</dt><dd>${C.escapeHtml(account.provider || "Email")}</dd></div>
            </dl>
          </section>
          <section class="profile-card">
            <h2>Overview</h2>
            <div class="metric-grid">
              <div><strong>${postedTasks.length}</strong><span>posted</span></div>
              <div><strong>${accepted.length}</strong><span>incubating</span></div>
              ${inReview.length ? `<div><strong>${inReview.length}</strong><span>in review</span></div>` : ""}
              <div><strong>${saved.length}</strong><span>saved</span></div>
            </div>
          </section>
          <section class="profile-card wide">
            <div class="card-title-row">
              <h2>My Hatches</h2>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.startNewHatch()">New Hatch</button>
            </div>
            ${miniTaskList(postedTasks, "Hatches you post will appear here.", { removable: true, type: "posted" })}
          </section>
          <section class="profile-card wide">
            <div class="card-title-row">
              <h2>Operator Hatches</h2>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.setRoute('browse')">Find Hatches</button>
            </div>
            ${miniTaskList(missions, "Saved or Incubating Hatches will appear here.", { removable: true, type: "mission" })}
          </section>
          <section class="profile-card wide">
            <div class="card-title-row">
              <h2>Messages${unread ? ` <span class="unread-badge">${unread} new</span>` : ""}</h2>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.setRoute('messages')">Open Messages</button>
            </div>
            <p class="muted-text">${unread
              ? `You have ${unread} unread message${unread === 1 ? "" : "s"} waiting.`
              : "Chat with clients and Operators, and get updates from Hatch, in Messages."}</p>
          </section>
          ${/* Operator application card DISABLED — joining as an Operator is instant now (no application or review step).
          <section class="profile-card wide">
            <div class="card-title-row">
              <h2>Operator application</h2>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.updateOperatorApplication()">${operatorApplications.length ? "Update application" : "Apply"}</button>
            </div>
            ${operatorApplicationSummary(operatorApplications)}
          </section>
          */ ""}
          ${account.isAdmin ? adminPanel(adminData, adminHatches) : ""}
        </div>
      </main>
    `;
  }

  // Admin control for the rolling stats banner: one number per figure the
  // banner cites, plus the growth-preview switch. Values come from the same
  // cache the banner renders from, so the inputs always show what's live. The
  // banner itself isn't shown on this (profile) page, so a live inline preview
  // updates as any field or the switch changes — that's what makes flipping
  // the switch visibly do something here. Save persists it to every visitor.
  function statsBannerAdminCard() {
    const stats = window.SkillNestApp?.getSiteStats?.() || {};
    const numberField = (id, label, value) => `
      <label class="stats-admin-field">
        <span>${label}</span>
        <input id="${id}" type="number" min="0" step="1" inputmode="numeric" value="${Number(value || 0)}" oninput="SkillNestApp.previewSiteStatsBanner()" />
      </label>
    `;
    return `
      <section class="profile-card wide admin-panel">
        <div class="card-title-row"><h2>Admin &middot; Stats banner</h2></div>
        <p class="muted-text">These numbers power the rolling banner under the top bar. They're shown to every visitor on the marketing, browse, and sign-up pages.</p>
        <form class="stats-admin-form" onsubmit="SkillNestApp.saveSiteStats(event)">
          <div class="stats-admin-grid">
            ${numberField("statActiveHatchers", "Active Operators", stats.activeHatchers)}
            ${numberField("statOpenHatches", "Open Hatches", stats.openHatches)}
            ${numberField("statActiveClients", "Active clients", stats.activeClients)}
            ${numberField("statHatchesLastWeek", "Hatches done last week", stats.hatchesLastWeek)}
            ${numberField("statPeople", "People (community total)", stats.people)}
          </div>
          <label class="stats-admin-switch">
            <input id="statPreviewMode" type="checkbox" ${stats.previewMode ? "checked" : ""} onchange="SkillNestApp.previewSiteStatsBanner()" />
            <span class="stats-admin-switch-track" aria-hidden="true"></span>
            <span class="stats-admin-switch-label">Show as a preview of what the live dashboard will show as we grow</span>
          </label>
          <label class="stats-admin-switch">
            <input id="statShowCardAge" type="checkbox" ${stats.showCardAge !== false ? "checked" : ""} />
            <span class="stats-admin-switch-track" aria-hidden="true"></span>
            <span class="stats-admin-switch-label">Show a "Posted … ago" time on each browse card</span>
          </label>
          <label class="stats-admin-switch">
            <input id="statAiDebug" type="checkbox" ${stats.aiDebug === true ? "checked" : ""} />
            <span class="stats-admin-switch-track" aria-hidden="true"></span>
            <span class="stats-admin-switch-label">AI debugging mode — show the intake debug panel, fallback notices, and console logs (leave off for a clean MVP)</span>
          </label>
          <div class="stats-admin-preview-wrap">
            <span class="filter-heading">Live preview</span>
            <div class="stats-admin-preview" id="statsBannerPreview">${C.statsBanner(stats)}</div>
          </div>
          <div class="stats-admin-actions">
            <button class="btn secondary small" type="submit">Save banner</button>
            <span class="muted-text" id="statsSaveStatus" aria-live="polite"></span>
          </div>
        </form>
      </section>
    `;
  }

  function adminPanel(adminData, adminHatches) {
    const applications = adminData.applications || [];
    const pending = applications.filter((application) => application.status === "pending");
    const reviewed = applications.length - pending.length;
    const sourceLabel = { posted: "posted here", seed: "demo listing", backend: "backend" };
    return `
      ${statsBannerAdminCard()}
      ${/* Admin · Operator applications review DISABLED — Operators no longer submit applications to approve/reject.
      <section class="profile-card wide admin-panel">
        <div class="card-title-row"><h2>Admin &middot; Operator applications</h2></div>
        ${pending.length ? `
          <div class="profile-list">
            ${pending.map((application) => `
              <article>
                <div>
                  <h3>${C.escapeHtml(application.name || application.username)} <span class="inbox-meta">@${C.escapeHtml(application.username)} &middot; ${C.escapeHtml(application.email)}</span></h3>
                  <p>${C.escapeHtml([application.background, application.tools, application.industries, application.exampleTasks].filter(Boolean).join(" · ") || "No details provided.")}</p>
                  ${(application.linkedin || application.resumeName) ? `<p class="application-links">
                    ${application.linkedin ? `<a href="${C.escapeHtml(application.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn profile</a>` : ""}
                    ${application.resumeName ? (application.resumeData
                      ? `<a href="${C.escapeHtml(application.resumeData)}" download="${C.escapeHtml(application.resumeName)}">Resume: ${C.escapeHtml(application.resumeName)}</a>`
                      : `<span>Resume: ${C.escapeHtml(application.resumeName)}</span>`) : ""}
                  </p>` : ""}
                  <input class="admin-note-input" id="adminAppNote-${Number(application.id)}" type="text" placeholder="Optional message for the applicant's inbox" />
                </div>
                <div class="mission-actions">
                  <button class="btn secondary small" type="button" onclick="SkillNestApp.adminReviewApplication(${Number(application.id)}, 'approve')">Approve</button>
                  <button class="btn ghost small danger" type="button" onclick="SkillNestApp.adminReviewApplication(${Number(application.id)}, 'reject')">Reject</button>
                </div>
              </article>
            `).join("")}
          </div>
        ` : `<p class="muted-text">No pending applications.</p>`}
        ${reviewed ? `<p class="muted-text">${reviewed} application${reviewed === 1 ? "" : "s"} reviewed earlier.</p>` : ""}
      </section>
      */ ""}
      <section class="profile-card wide admin-panel">
        <div class="card-title-row"><h2>Admin &middot; All Hatches</h2></div>
        ${adminHatches.length ? `
          <div class="profile-list">
            ${adminHatches.map((hatch) => `
              <article>
                <div>
                  <h3>${C.escapeHtml(hatch.title)}</h3>
                  <p>${C.escapeHtml(hatch.business || "")} &middot; ${C.escapeHtml(sourceLabel[hatch.source] || hatch.source)}</p>
                </div>
                <div class="mission-actions">
                  <span>${C.escapeHtml(hatch.status || "Open")}</span>
                  <button class="btn ghost small danger" type="button" onclick="SkillNestApp.adminDeleteHatch('${C.escapeHtml(hatch.id)}')">Delete</button>
                </div>
              </article>
            `).join("")}
          </div>
        ` : `<p class="muted-text">No Hatches to manage yet.</p>`}
      </section>
      <section class="profile-card wide admin-panel">
        <div class="card-title-row"><h2>Admin &middot; Send a message</h2></div>
        <form class="admin-message-form" onsubmit="SkillNestApp.adminSendMessage(event)">
          <input id="adminMessageTo" type="text" placeholder="Username or email" required />
          <input id="adminMessageSubject" type="text" placeholder="Subject" />
          <textarea id="adminMessageBody" rows="3" placeholder="Message" required></textarea>
          <button class="btn secondary small" type="submit">Send as direct message</button>
        </form>
      </section>
    `;
  }

  function operatorApplicationSummary(applications) {
    if (!applications.length) return `<p class="muted-text">Your Operator application summary will appear here after you apply.</p>`;
    const application = applications[0];
    const row = (label, value) => `<div><dt>${label}</dt><dd>${C.escapeHtml(value || "-")}</dd></div>`;
    const linkedinRow = application.linkedin
      ? `<div><dt>LinkedIn</dt><dd><a href="${C.escapeHtml(application.linkedin)}" target="_blank" rel="noopener noreferrer">${C.escapeHtml(application.linkedin)}</a></dd></div>`
      : "";
    const resumeRow = application.resumeName
      ? `<div><dt>Resume</dt><dd>${application.resumeData
          ? `<a href="${C.escapeHtml(application.resumeData)}" download="${C.escapeHtml(application.resumeName)}">${C.escapeHtml(application.resumeName)}</a>`
          : C.escapeHtml(application.resumeName)}</dd></div>`
      : "";
    return `
      <dl class="application-summary">
        ${row("Status", application.status)}
        ${application.reviewNote ? row("Reviewer note", application.reviewNote) : ""}
        ${row("Name", application.name)}
        ${row("Email", application.email)}
        ${row("Background", application.background)}
        ${row("Tools", application.tools)}
        ${row("Categories", application.industries)}
        ${row("Example Hatches", application.exampleTasks)}
        ${linkedinRow}
        ${resumeRow}
      </dl>
    `;
  }

  // LinkedIn-style inbox: conversation list + filter tabs on the left, the
  // selected thread on the right. On narrow screens the two panels swap via
  // the thread-open class (list first, thread slides in when one is picked).
  function messagesPage(account, state = {}) {
    // null = the first fetch hasn't landed yet; [] = truly no conversations.
    const loaded = Array.isArray(state.conversations);
    const conversations = loaded ? state.conversations : [];
    const filter = state.filter || "all";
    const activeId = state.activeId || null;
    const filters = [
      ["all", "All"],
      ["hatch", "Hatch-related"],
      ["unread", "Unread"],
      ["archived", "Archived"],
    ];
    const visible = conversations.filter((conversation) => {
      if (filter === "archived") return conversation.archived;
      if (conversation.archived) return false;
      if (filter === "hatch") return Boolean(conversation.hatchId);
      if (filter === "unread") return (conversation.unreadCount || 0) > 0;
      return true;
    });
    const emptyCopy = {
      all: "No conversations yet. Message someone from a Hatch, or start one with New message.",
      hatch: "No Hatch-related conversations yet. They start when you message someone from a Hatch page.",
      unread: "You're all caught up.",
      archived: "Nothing archived.",
    }[filter];

    return `
      <main class="section page messages-page">
        <div class="messages-shell ${activeId ? "thread-open" : ""}">
          <aside class="conversation-panel" aria-label="Conversations">
            <div class="conversation-panel-head">
              <h1>Messages</h1>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.openNewMessage()">New message</button>
            </div>
            <div class="msg-filter-tabs" role="tablist" aria-label="Filter conversations">
              ${filters.map(([id, label]) => `
                <button class="msg-filter-tab ${filter === id ? "active" : ""}" type="button" role="tab" aria-selected="${filter === id}" onclick="SkillNestApp.setMessagesFilter('${id}')">${label}</button>
              `).join("")}
            </div>
            <div class="conversation-list">
              ${visible.length
                ? visible.map((conversation) => C.conversationItem(conversation, activeId)).join("")
                : `<p class="conversation-empty">${loaded ? C.escapeHtml(emptyCopy) : "Loading conversations..."}</p>`}
            </div>
          </aside>
          ${messagesThreadPanel(state)}
        </div>
      </main>
    `;
  }

  function messagesThreadPanel(state) {
    const conversation = state.conversation;
    if (!state.activeId) {
      return `
        <section class="thread-panel thread-empty" aria-label="Conversation">
          <div class="thread-placeholder">
            <span aria-hidden="true">✉️</span>
            <h2>Pick a conversation</h2>
            <p>Choose a thread on the left, or start a new message.</p>
          </div>
        </section>
      `;
    }
    if (state.loading || !conversation) {
      return `<section class="thread-panel thread-empty" aria-label="Conversation"><div class="thread-placeholder"><p>Loading conversation...</p></div></section>`;
    }

    const isSystem = conversation.kind === "system";
    const name = C.conversationDisplayName(conversation);
    return `
      <section class="thread-panel" aria-label="Conversation with ${C.escapeHtml(name)}">
        <div class="thread-header">
          <button class="thread-back" type="button" aria-label="Back to conversations" onclick="SkillNestApp.closeThread()">←</button>
          ${C.conversationAvatar(conversation, "avatar-md")}
          <div class="thread-header-copy">
            <strong>${C.escapeHtml(name)}</strong>
            ${conversation.hatchId
              ? `<span>🥚 ${C.escapeHtml(conversation.hatchTitle || "Removed Hatch")}</span>`
              : `<span>${isSystem ? "Updates from the Hatch platform" : `@${C.escapeHtml(conversation.participants?.[0]?.username || "")}`}</span>`}
          </div>
          <button class="btn ghost small thread-archive" type="button" onclick="SkillNestApp.archiveConversation(${Number(conversation.id)}, ${conversation.archived ? "false" : "true"})">
            ${conversation.archived ? "Unarchive" : "Archive"}
          </button>
        </div>
        <div class="thread-body" id="threadBody">
          ${(state.messages || []).map((message) => C.messageBubble(message)).join("")}
        </div>
        ${isSystem
          ? `<div class="thread-compose system-note">These are automatic updates from Hatch — replies aren't needed.</div>`
          : `
            <form class="thread-compose" onsubmit="SkillNestApp.sendChatMessage(event)">
              <input id="chatComposeInput" type="text" placeholder="Write a message..." autocomplete="off" maxlength="5000" />
              <button class="btn primary small" type="submit">Send</button>
            </form>
          `}
      </section>
    `;
  }

  // Two related but separate choices, deliberately shown together: the language
  // Hatch's own interface speaks, and the language you want Hatches themselves
  // in. Reading English Hatches through a Chinese interface is a real combo, so
  // they are not collapsed into one control.
  function languageSettingsCard() {
    const I18n = window.HatchI18n;
    if (!I18n) return "";
    const uiLang = I18n.getLang();
    const { contentLanguage, foreignHatches } = I18n.getPrefs();

    const handlingOptions = [
      ["translate", "Translate them into my language", "Hatch machine-translates the listing. The original is always one click away."],
      ["original", "Show them as written", "No translation — you read every Hatch in its original language."],
      ["hide", "Hide them", "Only show Hatches already written in my language."],
    ];

    return `
      <section class="profile-card settings-card">
        <h2>Language</h2>
        <div class="settings-language-block">
          <div class="settings-language-row">
            <div>
              <h3 class="settings-subhead">Interface</h3>
              <p class="muted-text">The language Hatch's own buttons, labels, and pages use.</p>
            </div>
            <div class="language-switch" role="radiogroup" aria-label="Choose interface language">
              ${I18n.languages().map((lang) => `
                <button class="language-switch-option ${lang.code === uiLang ? "active" : ""}" type="button" role="radio" aria-checked="${lang.code === uiLang}" onclick="SkillNestApp.chooseLanguage('${lang.code}')">${C.escapeHtml(lang.native)}</button>
              `).join("")}
            </div>
          </div>
          <div class="settings-language-row">
            <div>
              <h3 class="settings-subhead">Hatches</h3>
              <p class="muted-text">The language you want to read Hatches in.</p>
            </div>
            <div class="language-switch" role="radiogroup" aria-label="Choose Hatch language">
              ${I18n.languages().map((lang) => `
                <button class="language-switch-option ${lang.code === contentLanguage ? "active" : ""}" type="button" role="radio" aria-checked="${lang.code === contentLanguage}" onclick="SkillNestApp.setContentLanguage('${lang.code}')">${C.escapeHtml(lang.native)}</button>
              `).join("")}
            </div>
          </div>
          <div class="settings-language-handling">
            <h3 class="settings-subhead">Hatches in other languages</h3>
            <div class="filter-options">
              ${handlingOptions.map(([value, label, hint]) => `
                <label class="filter-check filter-radio">
                  <input type="radio" name="settingsForeignHatches" value="${value}" ${value === foreignHatches ? "checked" : ""} onchange="SkillNestApp.setForeignHatchHandling('${value}')" />
                  <span>
                    <span class="filter-radio-label">${C.escapeHtml(label)}</span>
                    <small class="filter-radio-hint">${C.escapeHtml(hint)}</small>
                  </span>
                </label>
              `).join("")}
            </div>
            <p class="muted-text">This is the same setting as the language filter when you browse Hatches.</p>
          </div>
        </div>
      </section>
    `;
  }

  function settingsPage(account) {
    const notice = localStorage.getItem("hatchSettingsNotice") || "";
    return `
      <main class="section page">
        ${notice ? `<div class="success-message show profile-notice">${C.escapeHtml(notice)}</div>` : ""}
        <div class="settings-layout">
          <div class="form-copy">
            <div class="section-label">Manage account</div>
            <h1>Account settings.</h1>
            <p>Update how you appear across Hatch — your profile picture and display name.</p>
          </div>
          <div class="settings-column">
            <section class="profile-card settings-card">
              <h2>Profile picture</h2>
              <div class="settings-avatar-row">
                ${C.userAvatar(account, "avatar-xl")}
                <div class="settings-avatar-actions">
                  <input id="avatarFileInput" class="hidden-file" type="file" accept="image/*" onchange="SkillNestApp.handleAvatarFile(event)" />
                  <button class="btn secondary small" type="button" onclick="document.getElementById('avatarFileInput').click()">${account.avatar ? "Replace picture" : "Upload picture"}</button>
                  ${account.avatar ? `<button class="btn ghost small danger" type="button" onclick="SkillNestApp.removeAvatar()">Remove</button>` : ""}
                </div>
              </div>
              <p class="muted-text">Images are resized to a small square. Without one, your initials are shown.</p>
            </section>
            <section class="profile-card settings-card">
              <h2>Display name</h2>
              <form class="settings-name-form" onsubmit="SkillNestApp.saveAccountSettings(event)">
                <input id="settingsName" type="text" value="${C.escapeHtml(account.name || "")}" required />
                <button class="btn primary small" type="submit">Save</button>
              </form>
            </section>
            ${languageSettingsCard()}
            <section class="profile-card settings-card">
              <h2>Account</h2>
              <dl class="application-summary">
                <div><dt>Username</dt><dd>@${C.escapeHtml(account.username || "-")}</dd></div>
                <div><dt>Email</dt><dd>${C.escapeHtml(account.email || "-")}</dd></div>
                <div><dt>Role</dt><dd>${C.escapeHtml(account.role || "-")}</dd></div>
              </dl>
              <p class="muted-text">Username and email changes aren't available in this preview.</p>
            </section>
          </div>
        </div>
      </main>
    `;
  }

  function howItWorksPage() {
    return `
      <main>
        <section class="section page page-intro">
          <div class="section-label">How it works</div>
          <h1>Post a Hatch. Incubate the work. Receive the Hatched solution.</h1>
        </section>
      </main>
    `;
  }

  // Single destination for "learn more about Hatch" — folds together what
  // used to be two separate nav links to the same trust/levels content, plus
  // the process walkthrough and FAQ, neither of which lived anywhere reachable
  // from the menu before this.
  function aboutPage() {
    const rankingSignals = [
      ["Hatched work", "Real delivery history"],
      ["Client rating", "Quality from past work"],
      ["On-time delivery", "Reliability over time"],
      ["Industry experience", "Relevant business context"],
    ];

    const howItWorksSteps = [
      ["1", "Describe the work", "Talk to Chickie, Hatch's AI intake assistant, in plain language. It asks only what's still unclear and shapes everything into a structured brief."],
      ["2", "Review and post", "Check the brief, adjust anything that's off, and post it. Operators see the exact brief you approved — no re-explaining the project."],
      ["3", "An Operator claims it", "A verified Operator matched to the work claims the Hatch and gets started."],
      ["4", "Submit and review", "The Operator submits their work. You review it, request changes if something's missing, or approve it as complete."],
      ["5", "Resolve issues if they come up", "Either side can open a dispute if something's not working out. A Hatch can also be cancelled by the client any time before it's claimed."],
    ];

    const faq = [
      ["What exactly is a Hatch?", "One piece of business work — content, a website, a workflow, research — scoped into a brief an Operator can act on without back-and-forth."],
      ["Who are Operators?", "Verified people who deliver the work. They're leveled L1 through L4 by the complexity of Hatches they've actually completed, not by self-reported skills."],
      ["What if the work isn't right?", "Request changes before approving. If it still isn't resolved, either you or the Operator can open a dispute."],
      ["Can I cancel a Hatch?", "Yes — the client who posted it can cancel any time before an Operator claims it."],
      ["How is pricing set?", "You set a budget range when you post. The Hatch's level and expected timeline are part of what shapes a fair number."],
    ];

    return `
      <main>
        <section class="section page trust-page">
          <div class="section-label">About</div>
          <h1>About Hatch.</h1>
          <p class="section-kicker about-intro">Hatch pairs an AI intake assistant with verified Operators so a messy idea becomes a clear, executable brief — then real, delivered work. Clients describe what they need in plain language; Operators deliver it and build a track record that speaks for itself.</p>
          <div class="trust-block">
            <div class="section-head">
              <div>
                <h2>How Hatch works</h2>
                <p class="section-kicker">From a rough idea to delivered work, step by step.</p>
              </div>
            </div>
            <div class="level-grid mature-grid">
              ${howItWorksSteps.map(([step, title, text]) => `<article class="level-card"><span>${step}</span><h3>${title}</h3><p>${text}</p></article>`).join("")}
            </div>
          </div>
          <div class="trust-block">
            <div class="section-head">
              <div>
                <h2>Hatch Levels</h2>
                <p class="section-kicker">Hatches are grouped by complexity so Operators build up from simpler work.</p>
              </div>
            </div>
            <div class="level-grid mature-grid">
              ${levels.map(([level, title, text]) => `<article class="level-card"><span>${level}</span><h3>${title}</h3><p>${text}</p></article>`).join("")}
            </div>
          </div>
          <div class="trust-block">
            <div class="section-head">
              <div>
                <h2>Ranking Signals</h2>
                <p class="section-kicker">Profiles are ranked with delivery signals, not self-claimed expertise alone.</p>
              </div>
            </div>
            <div class="trust-grid mature-grid">
              ${rankingSignals.map(([title, text]) => `<article class="trust-card"><h3>${title}</h3><p>${text}</p></article>`).join("")}
            </div>
          </div>
          <div class="trust-block">
            <div class="section-head">
              <div>
                <h2>Operator Trust</h2>
                <p class="section-kicker">Operator cards show Hatched work, ratings, on-time delivery, and category context.</p>
              </div>
            </div>
            <div class="operator-grid section-nested mature-grid">${operators.map((operator) => C.operatorCard(operator)).join("")}</div>
          </div>
          <div class="trust-block">
            <div class="section-head">
              <div>
                <h2>Frequently asked</h2>
                <p class="section-kicker">Quick answers before you post or apply.</p>
              </div>
            </div>
            <div class="trust-grid mature-grid">
              ${faq.map(([question, answer]) => `<article class="trust-card"><h3>${question}</h3><p>${answer}</p></article>`).join("")}
            </div>
          </div>
        </section>
      </main>
    `;
  }

  // Bumped when the legal text changes; recorded against each account at signup
  // so consent is tied to the version the user actually saw.
  const LEGAL_VERSION = "2026-07-26";
  const LEGAL_EFFECTIVE = "July 26, 2026";

  // Shell shared by the Terms and Privacy pages so both read like the rest of
  // the site (section label, intro, "last updated") instead of a raw dump.
  function legalPage({ label, title, intro, sections }) {
    return `
      <main>
        <section class="section page legal-page">
          <div class="section-label">${label}</div>
          <h1>${title}</h1>
          <p class="section-kicker legal-intro">${intro}</p>
          <p class="legal-updated">Last updated: ${LEGAL_EFFECTIVE}</p>
          <div class="legal-body">
            ${sections.map(([heading, ...paras], index) => `
              <section class="legal-section">
                <h2>${index + 1}. ${heading}</h2>
                ${paras.map((p) => `<p>${p}</p>`).join("")}
              </section>
            `).join("")}
          </div>
          <p class="form-note legal-disclaimer">Hatch is an MVP preview. This document is a plain-language template for the prototype and is not legal advice. Questions? Email <a href="mailto:hello@hatch.example">hello@hatch.example</a>.</p>
        </section>
      </main>
    `;
  }

  function termsPage() {
    return legalPage({
      label: "Legal",
      title: "Terms & Conditions.",
      intro: "These terms are the agreement between you and Hatch when you create an account, post a Hatch, or deliver work as an Operator. By using Hatch you accept them.",
      sections: [
        ["Accepting these terms", "By creating an account or otherwise using Hatch, you confirm that you have read, understood, and agree to be bound by these Terms & Conditions and our Privacy Policy. If you do not agree, please do not use the platform."],
        ["Who can use Hatch", "You must be at least 18 years old and able to enter into a binding contract. When you sign up as a business or on behalf of one, you confirm you are authorized to accept these terms for that business."],
        ["Your account", "You are responsible for keeping your login details secure and for everything that happens under your account. Give us accurate information when you sign up and keep it current. Tell us promptly if you suspect any unauthorized use."],
        ["How Hatch works", "Hatch is a marketplace. Clients post Hatches — scoped pieces of business work — and verified Operators deliver them. Hatch provides the platform, the AI intake assistant, and the tools that connect the two sides. Hatch is not a party to the agreement between a client and an Operator, does not perform the work itself, and does not employ Operators."],
        ["Posting and claiming Hatches", "Clients are responsible for describing work accurately and setting a fair budget and timeline. Operators are responsible for delivering what was agreed, on time, and to a professional standard. Once an Operator claims a Hatch, both sides are expected to see it through the review process in good faith."],
        ["Payments", "Budgets are agreed between the client and the Operator at the point of posting and claiming. In this MVP preview no real payments are processed. When payments launch, applicable fees, payout timing, and refund rules will be disclosed before you are charged, and will form part of these terms."],
        ["Content and intellectual property", "You keep ownership of the content and materials you upload. You grant Hatch a limited license to store, display, and process that content only as needed to run the platform. Unless a client and Operator agree otherwise in writing, ownership of delivered work transfers to the client once the Hatch is approved and any agreed payment is made."],
        ["Acceptable use", "Do not use Hatch to post illegal, infringing, deceptive, or harmful work; to harass or defraud others; to bypass the platform to avoid fees; to scrape or overload the service; or to misrepresent your identity, skills, or verification status. We may remove content or suspend accounts that break these rules."],
        ["Disputes between users", "If a Hatch does not go as planned, use the built-in review and dispute tools first — a client can request changes before approving, and either side can open a dispute. Hatch may help mediate but is not obligated to resolve disputes and is not responsible for the outcome of work delivered by Operators."],
        ["Disclaimers", "Hatch is provided \"as is\" and \"as available.\" We do not guarantee that Operators will meet your expectations, that Hatches will be claimed, or that the service will be uninterrupted or error-free. AI-generated briefs and suggestions are aids, not guarantees, and should be reviewed before you rely on them."],
        ["Limitation of liability", "To the fullest extent permitted by law, Hatch is not liable for indirect, incidental, or consequential damages, or for the acts, omissions, or work quality of any client or Operator. Our total liability for any claim relating to the service is limited to the fees you paid to Hatch in the three months before the claim arose."],
        ["Suspension and termination", "You may close your account at any time. We may suspend or terminate access if you breach these terms or use the platform in a way that harms other users or Hatch. Sections that by their nature should survive termination — such as content licenses granted, disclaimers, and liability limits — will continue to apply."],
        ["Changes to these terms", "We may update these terms as Hatch evolves. When we make material changes we will update the date above and, where appropriate, notify you. Continuing to use Hatch after changes take effect means you accept the updated terms."],
        ["Contact", "Questions about these terms can be sent to hello@hatch.example."],
      ],
    });
  }

  function privacyPage() {
    return legalPage({
      label: "Legal",
      title: "Privacy Policy.",
      intro: "This policy explains what information Hatch collects, how we use it, and the choices you have. We aim to collect only what we need to run the platform.",
      sections: [
        ["Information you give us", "When you sign up we collect your username, name, email, chosen role, language preferences, and password. When you post or deliver a Hatch we collect the briefs, messages, files, and results you submit."],
        ["Information collected automatically", "To run the app in your browser we store data locally on your device — including your session, draft Hatches, and appearance settings — and basic technical information needed to keep you signed in and the service working."],
        ["How we use your information", "We use your information to create and secure your account, match clients with Operators, power the AI intake assistant, deliver messages, show your track record, and improve the platform. We do not sell your personal information."],
        ["When we share information", "Parts of your profile and the Hatches you post or complete are visible to other users so the marketplace can function. Verified results are shared publicly only when you choose to publish them. We may share data with service providers who help us operate Hatch, or when required by law."],
        ["Local storage and cookies", "Hatch stores information in your browser's local storage to keep you signed in and remember your preferences. Clearing your browser storage will sign you out and remove locally saved drafts and settings."],
        ["Data retention", "We keep your information for as long as your account is active or as needed to provide the service and meet legal obligations. You can ask us to delete your account and associated personal data."],
        ["Your choices", "You can review and update your account details and language preferences in settings at any time, and you can request access to or deletion of your personal data by contacting us."],
        ["Children's privacy", "Hatch is not intended for anyone under 18, and we do not knowingly collect information from children."],
        ["Changes to this policy", "We may update this policy as the platform changes. When we do, we will revise the date above and, for material changes, take reasonable steps to let you know."],
        ["Contact", "For any privacy question or request, email hello@hatch.example."],
      ],
    });
  }

  return {
    aboutPage,
    authPage,
    browsePage,
    findOperatorsPage,
    findClientsPage,
    homePage,
    howItWorksPage,
    messagesPage,
    operatorPage,
    hatchReviewPage,
    createHatchPage,
    privacyPage,
    profilePage,
    settingsPage,
    signupPage,
    taskReviewPage,
    termsPage,
    verifiedWorkPage,
    LEGAL_VERSION,
  };
})();
