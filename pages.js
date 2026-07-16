window.SkillNestPages = (() => {
  const { tasks, operators, levels, completedHatches } = window.SkillNestData;
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

  function fileLabel(file) {
    if (typeof file === "string") return C.escapeHtml(file);
    const size = file.size ? `${Math.ceil(file.size / 1024)} KB` : "Size unavailable";
    return `${C.escapeHtml(file.name)} (${C.escapeHtml(file.type || "file")} · ${size})`;
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

  function verifiedWorkPage() {
    const orderedWork = [...completedHatches].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
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

  function signupPage() {
    return `
      <main class="section page auth-page">
        <div class="auth-layout">
          <div class="form-copy">
            <div class="section-label">Create account</div>
            <h1>Set up your Hatch account.</h1>
            <p>Clients post Hatches. Hatchers hatch them.</p>
          </div>
          <form class="form-card auth-card" onsubmit="SkillNestApp.completeSignup(event)">
            ${socialAuthButtons()}
            <div class="auth-divider"><span>or create manually</span></div>
            <div class="form-grid">
              ${C.field("Username", "authUsername", "hatch_user")}
              ${C.field("Full name", "authName", "Your name")}
              ${C.field("Email", "authEmail", "you@example.com", "email")}
              ${C.field("Password", "authPassword", "Create a password", "password")}
              ${C.selectField("I am joining as", "authRole", ["Client", "Hatcher", "Client and Hatcher"])}
            </div>
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

  function postTaskPage(account, draftTask, generatedBrief) {
    const brief = generatedBrief?.ok ? generatedBrief : null;
    return `
      <main class="section page">
        <div class="form-layout">
          <div class="form-copy">
            <div class="section-label">Post Task</div>
            <h1>Post your project.</h1>
            <p>Keep it simple. Hatch uses the details to match the right Hatchers.</p>
            <div class="account-note">
              <span>Posting as</span>
              <strong>${C.escapeHtml(account.name || account.username || "Your account")}</strong>
              <p>${C.escapeHtml(account.email || "")}</p>
            </div>
          </div>
          <form class="form-card" onsubmit="SkillNestApp.submitTask(event)">
            <div class="form-grid">
              ${C.field("Name", "clientName", "Your name", "text", { value: account.name || "", readonly: true })}
              ${C.field("Email", "clientEmail", "you@example.com", "email", { value: account.email || "", readonly: true })}
              ${C.field("Business type", "businessType", "Cafe, salon, online store...", "text", { value: brief?.businessType === "To be confirmed" ? "" : brief?.businessType || "" })}
              ${C.selectField("Budget", "budgetRange", ["Under $100", "$100-300", "$300-1000", "$50 - $150", "$150 - $500", "$500 - $1,500", "$1,500+", "Flexible"], brief?.suggestedBudget || "")}
              ${C.selectField("Deadline", "deadline", ["1-3 days", "3-7 days", "1-2 weeks", "2-4 weeks", "This week", "2 weeks", "This month", "Flexible"], brief?.suggestedTimeline || "")}
              ${C.selectField("Category", "industry", ["Restaurant", "Retail", "Professional Services", "E-commerce", "Local Services", "Real Estate", "Education", "Operations", "Customer Support", "Website", "Content", "Design", "Other"], brief?.category || brief?.industry || "")}
              ${C.textAreaField("Hatch description", "taskDetails", "Describe the business problem and the solution you want.", draftTask)}
            </div>
            <button class="btn primary full" type="submit">Post Task</button>
            <div class="success" id="taskSuccess">Task posted. Recommended Hatchers are ready below.</div>
            <div id="recommendedOperators"></div>
          </form>
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
        <button class="btn primary full" type="submit">Continue</button>
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
    return `
      <form class="form-card" onsubmit="SkillNestApp.submitOperator(event)">
        <div class="form-grid single-column">
          ${C.choiceField("Industries you understand", "industries", ["Restaurants", "E-commerce", "Local Services", "Real Estate", "Education", "Health & wellness"], "Other industry", draft.industries || [])}
          ${C.choiceField("Example Hatches you can complete", "exampleTasks", ["Social posts", "Product descriptions", "Simple websites", "Customer reply templates", "Menus/flyers", "Spreadsheet cleanup"], "Other Hatches", draft.exampleTasks || [])}
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
    return `
      <main class="section page">
        <div class="form-layout">
          <div class="form-copy">
            <div class="section-label">Become a Hatcher</div>
            <h1>Apply to build practical Hatches.</h1>
            <p>${stepCopy[step] || stepCopy.account}</p>
            <div class="operator-info">
              <h2>Growth path</h2>
              <p>L1 support Hatches -> L2 business Hatches -> L3 specialized Hatches -> L4 strategy later.</p>
              <h2>What helps</h2>
              <p>Clear communication, reliable delivery, useful tools, and familiarity with a few categories.</p>
            </div>
          </div>
          <div class="wizard-column">
            ${operatorStepper(step)}
            ${stepMarkup}
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
        ${items.map((item) => `
          <article>
            <div>
              <h3>${C.escapeHtml(item.title)}</h3>
              <p>${C.escapeHtml(item.category || item.industry || item.business || "")} ${item.budget ? `&middot; ${C.escapeHtml(item.budget)}` : ""}</p>
            </div>
            <div class="mission-actions">
              <span>${C.escapeHtml(item.status || item.level || "Open")}</span>
              ${removable ? `<button class="btn ghost small danger" type="button" onclick="SkillNestApp.${removeHandler}('${item.id || encodeURIComponent(item.title)}')">${removeLabel}</button>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function profilePage(account, postedTasks, missions, operatorApplications = [], inbox = { messages: [], unreadCount: 0 }, adminData = { applications: [], hatches: [] }, adminHatches = []) {
    const accepted = missions.filter((mission) => mission.status === "Incubating" || mission.status === "Accepted");
    const saved = missions.filter((mission) => mission.status === "Saved");
    const profileNotice = localStorage.getItem("hatchProfileNotice") || "";
    const unread = inbox.unreadCount || 0;
    return `
      <main class="section page">
        ${profileNotice ? `<div class="success-message show profile-notice">${C.escapeHtml(profileNotice)}</div>` : ""}
        <div class="profile-hero">
          <div>
            <div class="section-label">Profile</div>
            <h1>${C.escapeHtml(account.name || account.username || "Your profile")}</h1>
            <p>${C.escapeHtml(account.email || "")}</p>
          </div>
          <div class="profile-actions">
            <button class="btn secondary" type="button" onclick="SkillNestApp.setRoute('post-task')">Post a Hatch</button>
            <button class="btn secondary" type="button" onclick="SkillNestApp.setRoute('browse')">Browse Hatches</button>
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
              <div><strong>${saved.length}</strong><span>saved</span></div>
            </div>
          </section>
          <section class="profile-card wide">
            <div class="card-title-row">
              <h2>My Hatches</h2>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.setRoute('post-task')">New Hatch</button>
            </div>
            ${miniTaskList(postedTasks, "Hatches you post will appear here.", { removable: true, type: "posted" })}
          </section>
          <section class="profile-card wide">
            <div class="card-title-row">
              <h2>Hatcher Hatches</h2>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.setRoute('browse')">Find Hatches</button>
            </div>
            ${miniTaskList(missions, "Saved or Incubating Hatches will appear here.", { removable: true, type: "mission" })}
          </section>
          <section class="profile-card wide">
            <div class="card-title-row">
              <h2>Inbox${unread ? ` <span class="unread-badge">${unread} new</span>` : ""}</h2>
              ${unread ? `<button class="btn ghost small" type="button" onclick="SkillNestApp.markAllMessagesRead()">Mark all read</button>` : ""}
            </div>
            ${inboxList(inbox)}
          </section>
          <section class="profile-card wide">
            <div class="card-title-row">
              <h2>Hatcher application</h2>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.setRoute('operator')">Update application</button>
            </div>
            ${operatorApplicationSummary(operatorApplications)}
          </section>
          ${account.isAdmin ? adminPanel(adminData, adminHatches) : ""}
        </div>
      </main>
    `;
  }

  function inboxList(inbox) {
    const messages = inbox.messages || [];
    if (!messages.length) {
      return `<p class="muted-text">Updates from clients, Hatchers, and the Hatch team will appear here.</p>`;
    }
    const kindLabel = { admin: "Hatch team", client: "Client update", hatcher: "Hatcher update", system: "Hatch" };
    return `
      <div class="profile-list inbox-list">
        ${messages.map((message) => `
          <article class="${message.read ? "" : "inbox-unread"}">
            <div>
              <h3>${C.escapeHtml(message.subject || "(no subject)")}</h3>
              <p>${C.escapeHtml(message.body)}</p>
              <p class="inbox-meta">${C.escapeHtml(kindLabel[message.kind] || "Hatch")}${message.from ? ` &middot; ${C.escapeHtml(message.from.name || message.from.username)}` : ""} &middot; ${C.escapeHtml(new Date(message.createdAt).toLocaleString())}</p>
            </div>
            <div class="mission-actions">
              ${message.read ? "" : `<button class="btn ghost small" type="button" onclick="SkillNestApp.markMessageRead(${Number(message.id)})">Mark read</button>`}
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function adminPanel(adminData, adminHatches) {
    const applications = adminData.applications || [];
    const pending = applications.filter((application) => application.status === "pending");
    const reviewed = applications.length - pending.length;
    const sourceLabel = { posted: "posted here", seed: "demo listing", backend: "backend" };
    return `
      <section class="profile-card wide admin-panel">
        <div class="card-title-row"><h2>Admin &middot; Hatcher applications</h2></div>
        ${pending.length ? `
          <div class="profile-list">
            ${pending.map((application) => `
              <article>
                <div>
                  <h3>${C.escapeHtml(application.name || application.username)} <span class="inbox-meta">@${C.escapeHtml(application.username)} &middot; ${C.escapeHtml(application.email)}</span></h3>
                  <p>${C.escapeHtml([application.background, application.tools, application.industries, application.exampleTasks].filter(Boolean).join(" · ") || "No details provided.")}</p>
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
          <button class="btn secondary small" type="submit">Send to inbox</button>
        </form>
      </section>
    `;
  }

  function operatorApplicationSummary(applications) {
    if (!applications.length) return `<p class="muted-text">Your Hatcher application summary will appear here after you apply.</p>`;
    const application = applications[0];
    const row = (label, value) => `<div><dt>${label}</dt><dd>${C.escapeHtml(value || "-")}</dd></div>`;
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
      </dl>
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

  function trustPage() {
    const rankingSignals = [
      ["Hatched work", "Real delivery history"],
      ["Client rating", "Quality from past work"],
      ["On-time delivery", "Reliability over time"],
      ["Industry experience", "Relevant business context"],
    ];

    return `
      <main>
        <section class="section page trust-page">
          <div class="section-label">Trust</div>
          <h1>Trust and ranking</h1>
          <div class="trust-block">
            <div class="section-head">
              <div>
                <h2>Hatch Levels</h2>
                <p class="section-kicker">Hatches are grouped by complexity so Hatchers build up from simpler work.</p>
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
                <h2>Hatcher Trust</h2>
                <p class="section-kicker">Hatcher cards show Hatched work, ratings, on-time delivery, and category context.</p>
              </div>
            </div>
            <div class="operator-grid section-nested mature-grid">${operators.map((operator) => C.operatorCard(operator)).join("")}</div>
          </div>
        </section>
      </main>
    `;
  }

  return {
    authPage,
    browsePage,
    homePage,
    howItWorksPage,
    operatorPage,
    postTaskPage,
    profilePage,
    signupPage,
    taskReviewPage,
    trustPage,
    verifiedWorkPage,
  };
})();
