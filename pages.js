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
        : "Local intake fallback";
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
    const uniqueLevels = [...new Set(allTasks.map((task) => task.level).filter(Boolean))];
    const industries = [...new Set(allTasks.map((task) => task.industry).filter(Boolean))];
    const browseNotice = localStorage.getItem("hatchBrowseNotice") || "";
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
          <div class="browse-tools" aria-label="Hatch filters">
            <label class="browse-search">
              <span>Search</span>
              <input id="taskSearch" type="search" placeholder="Search by task, business, or industry..." oninput="SkillNestApp.applyTaskFilters()" />
            </label>
            <label>
              <span>Level</span>
              <select id="levelFilter" onchange="SkillNestApp.applyTaskFilters()">
                <option value="">All levels</option>
                ${uniqueLevels.map((level) => `<option value="${level}">${C.levelName(level)}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>Industry</span>
              <select id="industryFilter" onchange="SkillNestApp.applyTaskFilters()">
                <option value="">All industries</option>
                ${industries.map((industry) => `<option value="${C.escapeHtml(industry)}">${industry}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="task-feedback" id="taskFeedback" role="status"></div>
          <div class="task-grid browse-grid" id="browseTaskGrid">
            ${allTasks.map((task) => C.taskCard(task, true)).join("")}
          </div>
          <div class="empty-state" id="emptyTasks">No Hatches match those filters.</div>
        </section>
      </main>
    `;
  }

  function verifiedWorkPage() {
    const orderedWork = [...completedHatches].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    return `
      <main>
        <section class="section page page-intro verified-work-intro">
          <div class="section-label">Verified Work</div>
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

  function operatorPage(account) {
    return `
      <main class="section page">
        <div class="form-layout">
          <div class="form-copy">
            <div class="section-label">Become a Hatcher</div>
            <h1>Apply to build practical Hatches.</h1>
            <p>Start with simple work. Build ratings and category experience over time.</p>
            <div class="operator-info">
              <h2>Growth path</h2>
              <p>L1 support Hatches -> L2 business Hatches -> L3 specialized Hatches -> L4 strategy later.</p>
              <h2>What helps</h2>
              <p>Clear communication, reliable delivery, useful tools, and familiarity with a few categories.</p>
            </div>
          </div>
          <form class="form-card" onsubmit="SkillNestApp.submitOperator(event)">
            <div class="form-grid">
              ${C.field("Name", "operatorName", "Your name", "text", { value: account.name || "" })}
              ${C.field("Email", "operatorEmail", "you@example.com", "email", { value: account.email || "" })}
              ${C.choiceField("Background", "background", ["Student", "Admin assistant", "Designer", "Marketer", "Developer", "Business owner"], "Other background")}
              ${C.choiceField("Tools you use", "tools", ["ChatGPT", "Claude", "Canva", "Notion", "Zapier", "Google Sheets", "Cursor", "Midjourney"], "Other tools")}
              ${C.choiceField("Industries you understand", "industries", ["Restaurants", "E-commerce", "Local services", "Real estate", "Education", "Health & wellness"], "Other industry")}
              ${C.choiceField("Example Hatches you can complete", "exampleTasks", ["Social posts", "Product descriptions", "Simple websites", "Customer reply templates", "Menus/flyers", "Spreadsheet cleanup"], "Other Hatches")}
            </div>
            <button class="btn primary full" type="submit">Apply</button>
            <div class="success" id="operatorSuccess">Application received. In a real version, Hatch would review your starting Hatch level.</div>
          </form>
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
              <span>${C.escapeHtml(item.status || (item.level ? C.levelName(item.level) : "") || "Open")}</span>
              ${removable ? `<button class="btn ghost small danger" type="button" onclick="SkillNestApp.${removeHandler}('${item.id || encodeURIComponent(item.title)}')">${removeLabel}</button>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function profilePage(account, postedTasks, missions, operatorApplications = []) {
    const accepted = missions.filter((mission) => mission.status === "Incubating" || mission.status === "Accepted");
    const saved = missions.filter((mission) => mission.status === "Saved");
    const profileNotice = localStorage.getItem("hatchProfileNotice") || "";
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
              <h2>Hatcher application</h2>
              <button class="btn secondary small" type="button" onclick="SkillNestApp.setRoute('operator')">Update application</button>
            </div>
            ${operatorApplicationSummary(operatorApplications)}
          </section>
        </div>
      </main>
    `;
  }

  function operatorApplicationSummary(applications) {
    if (!applications.length) return `<p class="muted-text">Your Hatcher application summary will appear here after you apply.</p>`;
    const application = applications[0];
    const row = (label, value) => `<div><dt>${label}</dt><dd>${C.escapeHtml(value || "-")}</dd></div>`;
    return `
      <dl class="application-summary">
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
                <p class="section-kicker">Hatches are sized like eggs — quail, chicken, goose, then ostrich — so Hatchers build up from simpler work.</p>
              </div>
            </div>
            <div class="level-grid mature-grid">
              ${levels.map(([level, title, text]) => `<article class="level-card"><span>🥚</span><h3>${C.levelName(level)} <span class="level-code">${level}</span></h3><p class="level-subtitle">${title}</p><p>${text}</p></article>`).join("")}
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
