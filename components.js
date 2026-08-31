window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  const { taskChips, operators, clients, hatchedWork, completedHatches, operatorProfiles } = window.SkillNestData;
  // Provided by components/primitives.js, components/local-brief-fallback.js,
  // and components/intake-wizard-ui.js, all loaded just before this file.
  const {
    escapeHtml, tag, avatarInitials, userAvatar, systemAvatar, statusInfo, statusBadge,
    field, selectField, textAreaField, choiceField, sentenceTitle, cleanSentence, normalizeTaskText,
    isLowQualityProjectInput, generateTaskBrief, isProjectReady, projectReadiness, understandingStatement,
    nextClarification, fallbackAssistantMessage, buildTaskBrief, taskBriefPreviewMarkup, suggestedObjective,
    readLocalJson,
  } = window.SkillNestComponents;

  function operatorForWork(work) {
    return operatorProfiles.find((profile) => profile.id === work.operatorId);
  }

  function visibleOperatorName(work) {
    const profile = operatorForWork(work);
    if (!work.showProfile) return "Private Operator";
    // Published results (from a real client review) carry a plain operatorName
    // instead of a seeded operatorProfiles entry, so fall back to that.
    return profile?.name || work.operatorName || "Private Operator";
  }

  function visibleEarnings(work) {
    return work.showEarnings ? work.amountEarned : "Earnings hidden";
  }

  function visibleCompletionTime(work) {
    return work.showCompletionTime ? work.completionTime : "Completion time hidden";
  }

  // The account dropdown behind the nav avatar (YouTube-style): identity at
  // the top, then the account destinations, then sign out. Rendered closed on
  // every page build; SkillNestApp.toggleProfileMenu() shows/hides it in
  // place, and document-level click/Escape handlers close it.
  function profileMenuMarkup(account) {
    const isDark = document.documentElement.classList.contains("dark-mode");
    return `
      <div class="profile-menu" id="profileMenu" role="menu" hidden>
        <div class="profile-menu-header">
          ${userAvatar(account, "avatar-lg")}
          <div class="profile-menu-identity">
            <strong>${escapeHtml(account.name || account.username || "Your account")}</strong>
            <span>@${escapeHtml(account.username || "")}</span>
            <a class="profile-menu-view-link" href="#profile" role="menuitem">View your profile</a>
          </div>
        </div>
        <div class="profile-menu-divider"></div>
        <a class="profile-menu-item" href="#profile" role="menuitem"><span aria-hidden="true">🥚</span> Your Hatches</a>
        <a class="profile-menu-item" href="#messages" role="menuitem"><span aria-hidden="true">✉️</span> Messages</a>
        <a class="profile-menu-item" href="#settings" role="menuitem"><span aria-hidden="true">⚙️</span> Manage account</a>
        <div class="profile-menu-divider"></div>
        <button class="profile-menu-item" type="button" role="menuitem" onclick="SkillNestApp.toggleDarkModeFromMenu(event)">
          <span aria-hidden="true" data-appearance-icon>${isDark ? "☾" : "☀"}</span> <span data-appearance-label>Appearance: ${isDark ? "Dark" : "Light"}</span>
        </button>
        <div class="profile-menu-divider"></div>
        <button class="profile-menu-item" type="button" role="menuitem" onclick="SkillNestApp.logout()"><span aria-hidden="true">↪</span> Sign out</button>
      </div>
    `;
  }

  function navMessagesButton(active) {
    let unread = 0;
    try {
      unread = Number(localStorage.getItem("hatchMessagesUnreadCache") || 0);
    } catch {
      unread = 0;
    }
    return `
      <a class="nav-icon-button ${active === "messages" ? "active" : ""}" href="#messages" aria-label="Messages${unread ? ` (${unread} unread)` : ""}">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2.5" y="5" width="19" height="14" rx="3"></rect>
          <path d="m3.5 7 8.5 6 8.5-6"></path>
        </svg>
        <span class="nav-msg-badge" data-msg-badge ${unread ? "" : "hidden"}>${unread > 99 ? "99+" : unread}</span>
      </a>
    `;
  }

  // "Hatches" and "Operators" collapsed into one "Browse" trigger with a
  // dropdown, so the top nav doesn't run out of room as more destinations get
  // added — the same crowding problem the "About Hatch" merge solved earlier.
  function browseNavDropdown(active) {
    const options = [
      ["browse", "#browse", "Hatches"],
      ["operators", "#operators", "Operators"],
      ["clients", "#clients", "Clients"],
    ];
    const isActive = options.some(([key]) => key === active);
    return `
      <div class="nav-browse-dropdown">
        <button class="nav-browse-button ${isActive ? "active" : ""}" type="button" id="navBrowseButton" aria-haspopup="menu" aria-expanded="false" onclick="SkillNestApp.toggleBrowseMenu(event)">
          <span>Browse</span>
          <span class="nav-browse-caret" aria-hidden="true">▾</span>
        </button>
        <div class="nav-browse-menu" id="navBrowseMenu" role="menu" hidden>
          ${options.map(([key, href, label]) => `
            <a href="${href}" role="menuitem" class="${active === key ? "active" : ""}">${label}</a>
          `).join("")}
        </div>
      </div>
    `;
  }

  // Rolling stats strip under the top nav. Two identical groups sit side by
  // side inside the track; the CSS marquee slides the track left by half its
  // width and loops, so the second group seamlessly takes over from the first.
  // previewMode reframes the same numbers as a forward-looking dashboard
  // preview (see the admin control that sets them).
  function statsBanner(stats = {}) {
    const nf = (value) => `${Number(value || 0).toLocaleString()}+`;
    const preview = Boolean(stats.previewMode);
    const lead = preview
      ? `📊 <strong>A preview of what our live dashboard will show as we grow</strong>`
      : `🟢 <strong>Live on Hatch right now</strong>`;
    const items = [
      lead,
      `🐣 <strong>${nf(stats.activeHatchers)}</strong> active Operators`,
      `📋 <strong>${nf(stats.openHatches)}</strong> open Hatches`,
      `🔍 <strong>${nf(stats.activeClients)}</strong> clients looking for Operators`,
      `✅ <strong>${nf(stats.hatchesLastWeek)}</strong> Hatches completed this week`,
      `👥 <strong>${nf(stats.people)}</strong> people in the Hatch community`,
    ];
    const group = items
      .map((item) => `<span class="stats-banner-item">${item}</span>`)
      .join(`<span class="stats-banner-dot" aria-hidden="true">•</span>`);
    return `
      <div class="stats-banner ${preview ? "preview" : "live"}" data-no-i18n role="region" aria-label="Hatch community stats">
        <div class="stats-banner-track">
          <div class="stats-banner-group">${group}</div>
          <div class="stats-banner-group" aria-hidden="true">${group}</div>
        </div>
      </div>
    `;
  }

  function nav(active, isLoggedIn, account) {
    // Notion-style split: logo + links grouped on the left, quiet "Log in"
    // link plus one solid CTA on the right. Signed-in users get the messages
    // icon and their avatar (which opens the account dropdown) instead.
    const accountCta = isLoggedIn
      ? `${navMessagesButton(active)}
         <div class="profile-menu-wrap">
           <button class="avatar-button" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Open account menu" onclick="SkillNestApp.toggleProfileMenu(event)">
             ${userAvatar(account, "avatar-sm")}
           </button>
           ${profileMenuMarkup(account)}
         </div>`
      : `<a class="nav-login" href="#auth">Log in</a>
         <button class="btn primary nav-cta" type="button" onclick="SkillNestApp.setRoute('signup')">Get Hatch free</button>`;

    // Existing Operators (signed in with an Operator role) already reach
    // the levels/ranking guide through "About Hatch" below, so they don't need
    // a second, differently-labeled link to the same page — only non-Operators
    // get the distinct "apply" call to action.
    const isOperator = isLoggedIn && /operator|operator/i.test(String(account.role || ""));
    const operatorLink = isOperator
      ? ""
      : `<a href="#operator" class="${active === "operator" ? "active" : ""}">Become an Operator</a>`;

    return `
      <header class="topbar">
        <nav class="nav" aria-label="Primary navigation">
          <div class="nav-left">
            <a class="brand" href="#home" aria-label="Hatch home">
              <img class="brand-logo" src="${document.documentElement.classList.contains("dark-mode") ? "assets/hatchlogo-dark.png" : "assets/hatchlogo.png"}?v=2" alt="Hatch logo" />
            </a>
            <div class="nav-primary">
              ${browseNavDropdown(active)}
              <div class="nav-links">
                <a href="#verified-work" class="${active === "verified-work" ? "active" : ""}">Verified Results</a>
                ${operatorLink}
                <a href="#about" class="secondary-link ${active === "about" ? "active" : ""}">About Hatch</a>
              </div>
            </div>
          </div>
          <div class="nav-actions">
            ${accountCta}
          </div>
        </nav>
      </header>
    `;
  }

  function taskPreviewMarkup(text, files = []) {
    if (!text.trim() && !files.length) {
      return `<div class="live-preview empty">Start typing, use voice input, or attach files to shape your Hatch.</div>`;
    }

    const brief = generateTaskBrief(text, files);
    return `
      <div class="live-preview show">
        ${brief.ok ? taskBriefPreviewMarkup(brief) : `<p>${escapeHtml(brief.error)}</p>`}
        ${files.length ? `<small>Attached: ${files.map((file) => escapeHtml(file.name || file)).join(", ")}</small>` : ""}
      </div>
    `;
  }

  function hero(draftText = "", files = []) {
    return `
      <section class="hero">
        <div class="hero-inner">
          <div class="hero-copy reveal">
            <h1>What do you need help with?</h1>
            <button class="hero-typewriter" type="button" aria-label="Focus the project description box" onclick="document.getElementById('taskPrompt')?.focus()">
              <span class="typewriter-prefix">I need help with</span>
              <span class="typewriter-pill"><span id="heroTypewriter"></span><span class="typewriter-caret" aria-hidden="true"></span></span>
            </button>
            <p class="hero-subtitle">Tell us everything.<br />Don’t worry about making it perfect.<br />Just explain your situation naturally, as if you were talking to a colleague.<br />The more context you give us, the better we can understand your project. Hatch will organize everything for you.</p>
          </div>
          ${taskComposer(draftText, files)}
        </div>
      </section>
    `;
  }

  // The AI-intake project box: a description field, voice/file tools, and the
  // "Continue" button that launches the Chickie chat via startTaskFlow(). Shared
  // by the homepage hero and the dedicated "Start a Hatch" page so both entry
  // points feed the exact same AI flow — there is only one way to create a Hatch.
  function taskComposer(draftText = "", files = [], options = {}) {
    const secondaryAction = options.secondaryAction === false
      ? ""
      : `<button class="btn secondary full" type="button" onclick="SkillNestApp.setRoute('browse')">Browse Hatches</button>`;
    return `
      <div class="task-box reveal">
        <label for="taskPrompt">Project description</label>
        <textarea id="taskPrompt" rows="6" placeholder="Explain what you’re trying to accomplish, what you already have, and what a good result would look like..." oninput="SkillNestApp.updateLiveTaskPreview()">${escapeHtml(draftText)}</textarea>
        <div class="inline-error" id="taskPromptError">Describe the Hatch first, even with one short sentence.</div>
        <div class="input-tools" aria-label="Task input options">
          <button class="tool-button voice-button" id="voiceInputButton" type="button" onclick="SkillNestApp.toggleVoiceInput()">Voice input</button>
          <button class="tool-button voice-control hidden" id="voicePauseButton" type="button" onclick="SkillNestApp.pauseVoiceInput()">Pause</button>
          <button class="tool-button voice-control hidden" id="voiceStopButton" type="button" onclick="SkillNestApp.stopVoiceInput()">Stop</button>
          <button class="tool-button voice-control hidden danger-tool" id="voiceDeleteButton" type="button" onclick="SkillNestApp.deleteVoiceTranscript()">Delete voice text</button>
          <button class="tool-button" type="button" onclick="document.getElementById('taskFile').click()">Attach files</button>
          <input id="taskFile" class="hidden-file" type="file" multiple onchange="SkillNestApp.handleTaskFiles(event)" />
        </div>
        <div class="voice-status show" id="voiceStatus" role="status">Your microphone is only used while recording.</div>
        <div class="file-summary" id="fileSummary"></div>
        <div class="file-preview-list" id="filePreviewList" data-file-preview></div>
        <div class="hero-actions">
          <button class="btn primary full" id="reviewTaskButton" type="button" onclick="SkillNestApp.startTaskFlow()">Continue</button>
          ${secondaryAction}
        </div>
        <div class="writing-prompts">
          <strong>Helpful things to mention:</strong>
          <span>What you’re trying to achieve</span>
          <span>Your business or project</span>
          <span>What you already have</span>
          <span>What success looks like</span>
          <span>Deadlines</span>
          <span>References</span>
        </div>
      </div>
    `;
  }

  // Right under the hero, so a first-time visitor sees messaging is a real,
  // built-in feature — not just a small icon that appears after logging in.
  function messagingFeatureSection() {
    const features = [
      ["💬", "Direct threads", "Message any Operator before or during a Hatch — no gig-site inbox, no waiting on a bid."],
      ["📎", "Tied to the work", "Tag a thread to its Hatch so context and files stay attached to the project instead of scattered across email."],
      ["🔔", "Nothing missed", "Unread counts, automatic updates, and archiving keep active conversations easy to find."],
    ];
    return `
      <section class="section messaging-section">
        <div class="section-head centered-head">
          <div>
            <div class="section-label">Messaging</div>
            <h2>Talk directly. No middleman.</h2>
            <p class="section-kicker">Clients and Operators message each other straight through Hatch — ask a question, share a file, or check on progress, without leaving the platform.</p>
          </div>
        </div>
        <div class="messaging-feature-grid">
          ${features.map(([icon, title, text]) => `
            <article class="audience-card reveal">
              <div class="stage-icon" aria-hidden="true">${icon}</div>
              <h3>${title}</h3>
              <p>${text}</p>
            </article>
          `).join("")}
        </div>
        <div class="messaging-actions">
          <button class="btn primary" type="button" onclick="SkillNestApp.setRoute('operators')">Browse Operators</button>
          <button class="btn secondary" type="button" onclick="SkillNestApp.setRoute('messages')">Open Messages</button>
        </div>
      </section>
    `;
  }

  function whyHatchSection() {
    const rows = [
      ["Describing the work", "Write the perfect brief yourself, or get ignored", "Just talk naturally — AI turns it into a complete brief"],
      ["Finding the right person", "Scroll hundreds of near-identical gigs and reviews", "Matched to a verified Operator who fits the project"],
      ["Speed", "Days of back-and-forth before work even starts", "AI-assisted scoping means work starts in hours, not days"],
      ["Pricing", "Race-to-the-bottom bidding on hourly rates", "Fair prices tied to outcomes and verified results"],
    ];

    return `
      <section class="section why-section">
        <div class="section-head centered-head">
          <div>
            <div class="section-label">Why Hatch</div>
            <h2>Not another gig marketplace.</h2>
            <p class="section-subtitle">Fiverr and similar platforms make you do the hard part: writing the brief, vetting strangers, and waiting. Hatch puts AI in the middle of every project, so both sides win.</p>
          </div>
        </div>
        <div class="compare-card reveal">
          <div class="compare-row compare-head">
            <span></span>
            <span>Traditional marketplaces</span>
            <span class="compare-hatch-col">Hatch</span>
          </div>
          ${rows.map(([label, them, us]) => `
            <div class="compare-row">
              <span class="compare-label">${label}</span>
              <span class="compare-them">${them}</span>
              <span class="compare-us">✓ ${us}</span>
            </div>
          `).join("")}
        </div>
        <div class="audience-grid">
          <article class="audience-card reveal">
            <div class="stage-icon" aria-hidden="true">🎓</div>
            <h3>For students &amp; freelancers</h3>
            <p>Your AI skills are worth more than $5 gigs. With AI handling the busywork, you deliver more projects, faster — and build verified results that let you level up and charge what the outcome is worth.</p>
          </article>
          <article class="audience-card reveal">
            <div class="stage-icon" aria-hidden="true">🏪</div>
            <h3>For small businesses</h3>
            <p>No more guessing what to write in a job post. Describe your problem in plain words, and AI shapes it into a brief a verified Operator can act on immediately — real help, faster than any gig site.</p>
          </article>
        </div>
      </section>
    `;
  }

  function hatchLifecycleSection() {
    const stages = [
      ["Stage 1", "🥚", "New Hatch", "Business owners post a real business problem they would like AI to solve."],
      ["Stage 2", "🛠", "Incubating", "A verified Operator develops and refines the solution."],
      ["Stage 3", "🐣", "Hatched", "The completed solution is delivered and ready for the business to use."],
    ];

    return `
      <section class="section lifecycle-section">
        <div class="section-head centered-head">
          <div>
            <div class="section-label">Hatch lifecycle</div>
            <h2>Every Great Solution Starts as a Hatch</h2>
          </div>
        </div>
        <div class="lifecycle-timeline">
          ${stages.map(([stage, icon, title, text]) => `
            <article class="lifecycle-step reveal">
              <span class="stage-label">${stage}</span>
              <div class="stage-icon" aria-hidden="true">${icon}</div>
              <h3>${title}</h3>
              <p>${text}</p>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function recentlyHatchedSection() {
    return `
      <section class="section hatched-section">
        <div class="section-head">
          <div>
            <div class="section-label">Hatched Work</div>
            <h2>Recently Hatched</h2>
          </div>
        </div>
        <div class="hatched-grid">
          ${hatchedWork.map((item) => `
            <article class="hatched-card reveal">
              <div class="card-top">
                ${statusBadge(item.status)}
                ${tag(item.category)}
              </div>
              <h3>${escapeHtml(item.title)}</h3>
              <span class="hatched-label">Outputs</span>
              <ul class="clean-list output-list">
                ${item.outputs.map((output) => `<li>✓ ${escapeHtml(output)}</li>`).join("")}
              </ul>
              <div class="time-saved">
                <span>Time saved</span>
                <strong>${escapeHtml(item.timeSaved)}</strong>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  // Lowest dollar amount in a budget string ("$60 - $120" -> 60); non-numeric
  // values ("Flexible") sort last.
  function budgetSortValue(budget) {
    const match = String(budget || "").replace(/,/g, "").match(/\d+(\.\d+)?/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
  }

  // Estimated completion normalized to days ("2 days" -> 2, "1 week" -> 7);
  // non-numeric values ("Flexible") sort last.
  function completionSortValue(text) {
    const str = String(text || "").toLowerCase();
    const match = str.match(/\d+(\.\d+)?/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const num = Number(match[0]);
    if (str.includes("hour")) return num / 24;
    if (str.includes("week")) return num * 7;
    if (str.includes("month")) return num * 30;
    return num; // days (default unit)
  }

  // Numeric part of a level label ("L2" -> 2); unknown levels sort last.
  function levelSortValue(level) {
    const match = String(level || "").match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
  }

  // Human label for a range-slider value: "$444" for price, "3 days" for length.
  function formatRangeValue(format, value) {
    const n = Number(value);
    if (format === "price") return `$${n}`;
    if (format === "days") return `${n} ${n === 1 ? "day" : "days"}`;
    return String(n);
  }

  // Dual-thumb range slider (two overlaid range inputs). `format` drives the
  // value labels; the min/max thumbs stay within [min, max] and never cross.
  function rangeFilterMarkup({ id, min, max, format }) {
    return `
      <div class="range-slider" id="${id}" data-format="${format}">
        <div class="range-values">
          <span data-role="low">${formatRangeValue(format, min)}</span>
          <span data-role="high">${formatRangeValue(format, max)}</span>
        </div>
        <div class="range-inputs">
          <div class="range-track"><div class="range-fill" data-role="fill" style="left:0%;right:0%"></div></div>
          <input type="range" class="range-thumb range-thumb-min" data-role="min" min="${min}" max="${max}" value="${min}" oninput="SkillNestApp.handleRangeInput('${id}', 'min')" aria-label="Minimum" />
          <input type="range" class="range-thumb range-thumb-max" data-role="max" min="${min}" max="${max}" value="${max}" oninput="SkillNestApp.handleRangeInput('${id}', 'max')" aria-label="Maximum" />
        </div>
      </div>
    `;
  }

  // A Hatch written in another language renders one of three ways, per the
  // reader's content-language preference: machine-translated (with a badge back
  // to the original), left as written with a language badge, or filtered out
  // entirely by applyTaskFilters. Translation is resolved from cache here so a
  // seen-before Hatch paints translated on the first frame; uncached ones get
  // marked for the async hydration pass in app.js.
  function taskLanguageState(task) {
    const I18n = window.HatchI18n;
    if (!I18n) return { source: "en", display: task, translated: false, pending: false };
    const { contentLanguage, foreignHatches } = I18n.getPrefs();
    const source = I18n.taskLanguage(task);
    if (source === contentLanguage) return { source, display: task, translated: false, pending: false };
    if (foreignHatches !== "translate") return { source, display: task, translated: false, pending: false };

    const cached = window.HatchTranslate?.getCached(task, contentLanguage);
    if (cached) {
      return { source, display: window.HatchTranslate.merge(task, cached), translated: true, pending: false };
    }
    return { source, display: task, translated: false, pending: true };
  }

  function languageBadge(state) {
    const I18n = window.HatchI18n;
    if (!I18n) return "";
    const sourceName = I18n.languageOf(state.source).native;
    if (state.translated) {
      return `
        <button class="task-language-badge translated" type="button" onclick="event.stopPropagation(); SkillNestApp.toggleTaskOriginal(event)">
          <span aria-hidden="true">🌐</span>
          <span data-i18n-source="${escapeHtml(sourceName)}">Translated from ${escapeHtml(sourceName)}</span>
          <span class="task-language-toggle">View original</span>
        </button>
      `;
    }
    if (state.pending) {
      return `<span class="task-language-badge pending"><span aria-hidden="true">🌐</span><span>Translating…</span></span>`;
    }
    return `<span class="task-language-badge"><span aria-hidden="true">🌐</span><span>${escapeHtml(sourceName)}</span></span>`;
  }

  // Compact "time since" label for card footers ("just now", "3 hours ago",
  // "2 days ago"). Returns "" for a missing/unparseable timestamp so callers
  // can simply omit the line.
  function timeAgo(input) {
    const then = new Date(input).getTime();
    if (Number.isNaN(then)) return "";
    const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (secs < 45) return "just now";
    const units = [
      [60, "minute"],
      [3600, "hour"],
      [86400, "day"],
      [604800, "week"],
      [2592000, "month"],
      [31536000, "year"],
    ];
    // Find the largest unit that fits, then count in that unit.
    let label = "minute";
    let divisor = 60;
    for (let i = 0; i < units.length; i += 1) {
      if (secs < units[i][0]) break;
      divisor = units[i][0];
      label = units[i][1];
    }
    const value = Math.max(1, Math.floor(secs / divisor));
    return `${value} ${label}${value === 1 ? "" : "s"} ago`;
  }

  // Grey "Posted … ago" line pinned to a card's bottom edge. Admins can hide it
  // site-wide via the showCardAge stat flag (defaults on).
  function cardAgeLine(dateStr) {
    const posted = dateStr || "";
    const ageText = posted ? timeAgo(posted) : "";
    const showAge = (window.SkillNestApp?.getSiteStats?.() || {}).showCardAge !== false;
    if (!showAge || !ageText) return "";
    return `<div class="task-card-age"><time datetime="${escapeHtml(String(posted))}">Posted ${ageText}</time></div>`;
  }

  function taskCard(task, interactive = false) {
    const state = taskLanguageState(task);
    const shown = state.display;
    const status = statusInfo(shown.status);
    const isOpen = status.label === "New Hatch";
    const category = shown.category || shown.industry;
    const completion = shown.estimatedCompletion || shown.timeline;
    const objective = shown.objective || shown.description;
    const foreign = state.source !== (window.HatchI18n?.getPrefs().contentLanguage || "en");
    // Search matches against both the original and translated text, so a query
    // in either language finds the Hatch regardless of how it is displayed.
    const searchable = `${shown.title} ${shown.business} ${shown.industry} ${category} ${shown.status}`
      + (state.translated ? ` ${task.title} ${task.business}` : "");
    return `
      <article class="task-card status-${status.className}" data-task-id="${task.id}" data-level="${task.level}" data-level-num="${levelSortValue(task.level)}" data-price="${budgetSortValue(task.budget)}" data-days="${completionSortValue(completion)}" data-industry="${escapeHtml(task.industry)}" data-language="${escapeHtml(state.source)}" ${state.pending ? 'data-needs-translation="1"' : ""} data-interactive="${interactive ? "1" : "0"}" data-search="${escapeHtml(searchable)}" onclick="SkillNestApp.openTaskDetail('${task.id}')">
        <div class="card-top">
          <span class="level-ribbon">${task.level}</span>
          ${statusBadge(shown.status)}
        </div>
        <h3>${escapeHtml(shown.title)}</h3>
        <p class="task-objective">${escapeHtml(objective)}</p>
        ${foreign ? languageBadge(state) : ""}
        ${state.translated ? `
          <div class="task-original" hidden>
            <h4>${escapeHtml(task.title)}</h4>
            <p>${escapeHtml(task.objective || task.description || "")}</p>
          </div>
        ` : ""}
        <div class="task-card-footer">
          <strong class="task-budget">${escapeHtml(task.budget)}</strong>
          <div class="task-meta-row">
            ${tag(category)}
            ${tag(completion)}
          </div>
          ${interactive ? `
            <div class="task-actions" onclick="event.stopPropagation()">
              <button class="btn primary small view-action" type="button" onclick="SkillNestApp.openTaskDetail('${task.id}')">View details</button>
            </div>
          ` : ""}
        </div>
        ${cardAgeLine(task.createdAt || task.postedAt)}
      </article>
    `;
  }

  function operatorCard(operator, compact = false) {
    return `
      <article class="operator-card ${compact ? "compact-operator" : ""}" onclick="SkillNestApp.openOperatorProfile('${operator.id}')">
        <div class="operator-head">
          <div class="avatar">${operator.initials}</div>
          <div>
            <h3>${escapeHtml(operator.name)}</h3>
            <p>${escapeHtml(operator.level)}</p>
          </div>
        </div>
        <div class="metric-grid">
          <div><strong>${operator.completed}</strong><span>hatched</span></div>
          <div><strong>${operator.rating}</strong><span>rating</span></div>
          <div><strong>${operator.onTime}</strong><span>on-time</span></div>
        </div>
        <div class="tag-row">${operator.industries.map((item) => tag(item)).join("")}</div>
        <p class="tools">Tools: ${operator.tools.join(", ")}</p>
      </article>
    `;
  }

  // Quality + responsiveness + recency, blended into one 0-100 ranking score.
  // Rating and on-time delivery carry the most weight since they're the
  // clearest signal of good work; completed count uses a log curve so a
  // veteran with 50 jobs can't automatically outrank someone with 20 great
  // ones. Response time and days-since-active reward Operators who are
  // actually around and quick to reply right now, not just historically good.
  // An optional context (industry/tools the browsing client cares about)
  // adds a match boost on top of that baseline quality score.
  const OPERATOR_SCORE_WEIGHTS = {
    rating: 0.30,
    onTime: 0.20,
    completed: 0.15,
    responseTime: 0.15,
    repeatClients: 0.10,
    recency: 0.10,
  };

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function daysSince(dateStr) {
    const then = new Date(dateStr).getTime();
    return Number.isNaN(then) ? null : Math.max(0, (Date.now() - then) / 86400000);
  }

  function operatorMatchScore(operator, context = {}) {
    const rating = clamp01((parseFloat(operator.rating) - 4) / 1);
    const onTime = clamp01((parseFloat(operator.onTime) - 70) / 30);
    const completed = clamp01(Math.log2((Number(operator.completed) || 0) + 1) / Math.log2(51));
    const responseTime = Number.isFinite(operator.avgResponseMinutes)
      ? clamp01(1 - (operator.avgResponseMinutes - 5) / 175)
      : 0.5; // unknown response time: neither rewarded nor penalized
    const repeatClients = clamp01((Number(operator.repeatClientRate) || 0) / 100);
    const activeDaysAgo = daysSince(operator.lastActiveAt);
    const recency = activeDaysAgo === null ? 0.5 : clamp01(1 - activeDaysAgo / 30);

    const baseScore = 100 * (
      OPERATOR_SCORE_WEIGHTS.rating * rating +
      OPERATOR_SCORE_WEIGHTS.onTime * onTime +
      OPERATOR_SCORE_WEIGHTS.completed * completed +
      OPERATOR_SCORE_WEIGHTS.responseTime * responseTime +
      OPERATOR_SCORE_WEIGHTS.repeatClients * repeatClients +
      OPERATOR_SCORE_WEIGHTS.recency * recency
    );

    const industryMatch = context.industry && (operator.industries || []).includes(context.industry) ? 15 : 0;
    const toolOverlap = context.tools?.length
      ? (operator.tools || []).filter((tool) => context.tools.includes(tool)).length
      : 0;
    const toolMatch = Math.min(10, toolOverlap * 4);

    return Math.round(clamp01((baseScore + industryMatch + toolMatch) / 100) * 100);
  }

  // "L2 Operator" / "L3 Specialist" -> "L2" / "L3", for level-filter checkboxes.
  function operatorLevelBucket(level = "") {
    const match = String(level).match(/L\d/);
    return match ? match[0] : level;
  }

  // Directory row: profile image on the left, details on the right — the
  // Operator counterpart to a browse task-card, but laid out two per row
  // instead of a card grid, since a person reads more naturally as a wide row
  // than a tall tile. Clicking anywhere opens the full profile; the message
  // button is a direct line that doesn't require opening it first.
  function operatorDirectoryCard(operator, context = {}) {
    const searchable = `${operator.name} ${operator.bio} ${operator.industries.join(" ")} ${operator.tools.join(" ")}`;
    return `
      <article class="operator-row-card" data-operator-id="${operator.id}" data-level="${escapeHtml(operatorLevelBucket(operator.level))}" data-level-num="${levelSortValue(operator.level)}" data-rating="${parseFloat(operator.rating) || 0}" data-completed="${Number(operator.completed) || 0}" data-ontime="${parseFloat(operator.onTime) || 0}" data-score="${operatorMatchScore(operator, context)}" data-industry="${escapeHtml(operator.industries[0] || "")}" data-industry-list="${escapeHtml(operator.industries.join("|"))}" data-search="${escapeHtml(searchable)}" onclick="SkillNestApp.openOperatorProfile('${operator.id}')">
        <div class="operator-row-avatar">${userAvatar(operator, "avatar-xl")}</div>
        <div class="operator-row-body">
          <div class="operator-row-head">
            <div>
              <h3>${escapeHtml(operator.name)}</h3>
              <p class="operator-row-level">${escapeHtml(operator.level)}</p>
            </div>
            <button class="btn secondary small operator-message-btn" type="button" onclick="event.stopPropagation(); SkillNestApp.messageOperator('${operator.id}')">✉️ Message</button>
          </div>
          <p class="operator-row-bio">${escapeHtml(operator.bio)}</p>
          <div class="metric-grid compact-metric-grid">
            <div><strong>${operator.completed}</strong><span>hatched</span></div>
            <div><strong>${operator.rating}</strong><span>rating</span></div>
            <div><strong>${operator.onTime}</strong><span>on-time</span></div>
          </div>
          <div class="tag-row">${operator.industries.map((item) => tag(item)).join("")}</div>
        </div>
      </article>
    `;
  }

  function recommendedOperators(industry = "", tools = []) {
    const context = { industry, tools };
    const recommended = [...operators]
      .sort((a, b) => operatorMatchScore(b, context) - operatorMatchScore(a, context))
      .slice(0, 3);

    return `
      <div class="recommendations">
        <div class="card-title-row">
          <h2>Recommended Operators</h2>
          <span class="tag">${industry ? `Matched to ${escapeHtml(industry)}` : "Top rated"}</span>
        </div>
        <div class="operator-grid">${recommended.map((operator) => operatorCard(operator, true)).join("")}</div>
      </div>
    `;
  }

  // ── Clients directory ────────────────────────────────────────────────────
  // The Operator-facing counterpart to the pieces above: same match-score /
  // card / recommended-row shapes as `operators`, reading client-semantic
  // fields (posted, hireRate, repeatOperatorRate) instead of the Operator ones,
  // and reusing the operator-row-* presentation classes so both directories
  // look identical. Only one of the two routes renders at a time, so sharing
  // the CSS classes never collides.
  function clientMatchScore(client, context = {}) {
    const rating = clamp01((parseFloat(client.rating) - 4) / 1);
    const hire = clamp01((parseFloat(client.hireRate) - 70) / 30);
    const posted = clamp01(Math.log2((Number(client.posted) || 0) + 1) / Math.log2(51));
    const responseTime = Number.isFinite(client.avgResponseMinutes)
      ? clamp01(1 - (client.avgResponseMinutes - 5) / 175)
      : 0.5;
    const repeatOperators = clamp01((Number(client.repeatOperatorRate) || 0) / 100);
    const activeDaysAgo = daysSince(client.lastActiveAt);
    const recency = activeDaysAgo === null ? 0.5 : clamp01(1 - activeDaysAgo / 30);

    const baseScore = 100 * (
      OPERATOR_SCORE_WEIGHTS.rating * rating +
      OPERATOR_SCORE_WEIGHTS.onTime * hire +
      OPERATOR_SCORE_WEIGHTS.completed * posted +
      OPERATOR_SCORE_WEIGHTS.responseTime * responseTime +
      OPERATOR_SCORE_WEIGHTS.repeatClients * repeatOperators +
      OPERATOR_SCORE_WEIGHTS.recency * recency
    );

    const industryMatch = context.industry && (client.industries || []).includes(context.industry) ? 15 : 0;
    const toolOverlap = context.tools?.length
      ? (client.tools || []).filter((tool) => context.tools.includes(tool)).length
      : 0;
    const toolMatch = Math.min(10, toolOverlap * 4);

    return Math.round(clamp01((baseScore + industryMatch + toolMatch) / 100) * 100);
  }

  function clientDirectoryCard(client, context = {}) {
    const searchable = `${client.name} ${client.contact || ""} ${client.bio} ${client.industries.join(" ")} ${client.tools.join(" ")}`;
    return `
      <article class="operator-row-card" data-client-id="${client.id}" data-type="${escapeHtml(client.type)}" data-rating="${parseFloat(client.rating) || 0}" data-posted="${Number(client.posted) || 0}" data-hire="${parseFloat(client.hireRate) || 0}" data-score="${clientMatchScore(client, context)}" data-industry="${escapeHtml(client.industries[0] || "")}" data-industry-list="${escapeHtml(client.industries.join("|"))}" data-search="${escapeHtml(searchable)}" onclick="SkillNestApp.openClientProfile('${client.id}')">
        <div class="operator-row-avatar">${userAvatar(client, "avatar-xl")}</div>
        <div class="operator-row-body">
          <div class="operator-row-head">
            <div>
              <h3>${escapeHtml(client.name)}</h3>
              <p class="operator-row-level">${escapeHtml(client.type)}${client.contact ? ` · ${escapeHtml(client.contact)}` : ""}</p>
            </div>
            <button class="btn secondary small operator-message-btn" type="button" onclick="event.stopPropagation(); SkillNestApp.messageClient('${client.id}')">✉️ Message</button>
          </div>
          <p class="operator-row-bio">${escapeHtml(client.bio)}</p>
          <div class="metric-grid compact-metric-grid">
            <div><strong>${client.posted}</strong><span>posted</span></div>
            <div><strong>${client.rating}</strong><span>rating</span></div>
            <div><strong>${client.hireRate}</strong><span>hire rate</span></div>
          </div>
          <div class="tag-row">${client.industries.map((item) => tag(item)).join("")}</div>
        </div>
      </article>
    `;
  }

  function clientCard(client, compact = false) {
    return `
      <article class="operator-card ${compact ? "compact-operator" : ""}" onclick="SkillNestApp.openClientProfile('${client.id}')">
        <div class="operator-head">
          <div class="avatar">${client.initials}</div>
          <div>
            <h3>${escapeHtml(client.name)}</h3>
            <p>${escapeHtml(client.type)}</p>
          </div>
        </div>
        <div class="metric-grid">
          <div><strong>${client.posted}</strong><span>posted</span></div>
          <div><strong>${client.rating}</strong><span>rating</span></div>
          <div><strong>${client.hireRate}</strong><span>hire rate</span></div>
        </div>
        <div class="tag-row">${client.industries.map((item) => tag(item)).join("")}</div>
        <p class="tools">Tools: ${client.tools.join(", ")}</p>
      </article>
    `;
  }

  function recommendedClients(industry = "", tools = []) {
    const context = { industry, tools };
    const recommended = [...clients]
      .sort((a, b) => clientMatchScore(b, context) - clientMatchScore(a, context))
      .slice(0, 3);

    return `
      <div class="recommendations">
        <div class="card-title-row">
          <h2>Recommended clients</h2>
          <span class="tag">${industry ? `Matched to ${escapeHtml(industry)}` : "Top rated"}</span>
        </div>
        <div class="operator-grid">${recommended.map((client) => clientCard(client, true)).join("")}</div>
      </div>
    `;
  }

  function clientDetail(client) {
    return modal(`
      <div class="operator-head detail-operator-head">
        <div class="avatar">${client.initials}</div>
        <div>
          <h1>${escapeHtml(client.name)}</h1>
          <p>${escapeHtml(client.type)}${client.contact ? ` · ${escapeHtml(client.contact)}` : ""}</p>
        </div>
      </div>
      <p>${escapeHtml(client.bio)}</p>
      <div class="metric-grid">
        <div><strong>${client.posted}</strong><span>posted</span></div>
        <div><strong>${client.rating}</strong><span>rating</span></div>
        <div><strong>${client.hireRate}</strong><span>hire rate</span></div>
      </div>
      <div class="tag-row">${client.industries.map((item) => tag(item)).join("")}</div>
      <div class="task-actions modal-actions">
        <button class="btn primary full" type="button" onclick="SkillNestApp.messageClient('${client.id}')">✉️ Message <span data-no-i18n>${escapeHtml(client.name)}</span></button>
      </div>
      <div class="operator-tabs">
        <button class="tab active" type="button" onclick="SkillNestApp.showOperatorTab(event, 'posts')">Recent posts</button>
        <button class="tab" type="button" onclick="SkillNestApp.showOperatorTab(event, 'industries')">Industries</button>
        <button class="tab" type="button" onclick="SkillNestApp.showOperatorTab(event, 'tools')">Tools</button>
      </div>
      <div class="tab-panel show" data-tab-panel="posts">
        <div class="offer-list">
          ${client.recentPosts.map((post) => `
            <article>
              <strong>${escapeHtml(post.title)}</strong>
              <span>${escapeHtml(post.industry)} · ${escapeHtml(post.level)} · ${escapeHtml(post.status)}</span>
            </article>
          `).join("")}
        </div>
      </div>
      <div class="tab-panel" data-tab-panel="industries">
        <div class="tag-row">${client.industries.map((item) => tag(item)).join("")}</div>
      </div>
      <div class="tab-panel" data-tab-panel="tools">
        <div class="tag-row">${client.tools.map((item) => tag(item)).join("")}</div>
      </div>
    `);
  }

  function verifiedWorkCard(work) {
    const profile = operatorForWork(work);
    const canOpenProfile = Boolean(work.showProfile && profile);
    const operatorName = work.showProfile ? (profile?.name || work.operatorName || "Private Operator") : "Private Operator";
    const operatorMeta = work.showProfile
      ? (profile ? `${profile.level} · ${profile.specialization}` : (work.operatorMeta || "Verified Operator"))
      : "Profile hidden";
    const initials = profile?.initials || work.operatorInitials || "H";
    // Real, client-approved deliverables carry a submission — flag it so people
    // know the card opens to the actual work handed in, not just a summary.
    const hasDeliverable = Boolean(work.submission);
    return `
      <article class="verified-feed-item">
        <div class="verified-feed-head">
          <button class="verified-operator-link" type="button" ${canOpenProfile ? `onclick="SkillNestApp.openVerifiedOperatorProfile('${profile.id}')"` : "disabled"} aria-label="View ${escapeHtml(operatorName)} profile">
            <div class="avatar small-avatar">${escapeHtml(initials)}</div>
          </button>
          <button class="verified-operator-link verified-operator-name" type="button" ${canOpenProfile ? `onclick="SkillNestApp.openVerifiedOperatorProfile('${profile.id}')"` : "disabled"}>
            <strong>${escapeHtml(operatorName)}</strong>
            <span>${escapeHtml(work.completedAt)} · ${escapeHtml(work.industry)} · ${escapeHtml(work.level)}</span>
          </button>
          <span class="verified-status">Verified delivery</span>
        </div>
        <div class="verified-feed-body">
          <h3>${escapeHtml(work.title)}</h3>
          <p>${escapeHtml(work.outcome)}</p>
        </div>
        <div class="verified-feed-meta">
          <span>Completed ${escapeHtml(visibleCompletionTime(work))}</span>
          <span>${escapeHtml(visibleEarnings(work))}</span>
          <span>★★★★★ ${escapeHtml(work.rating)}</span>
        </div>
        <p class="verified-feed-note">${escapeHtml(operatorMeta)}${hasDeliverable ? ` <span class="verified-deliverable-flag">✓ Delivered result attached</span>` : ""}</p>
        <div class="task-actions verified-feed-actions">
          <button class="btn secondary small" type="button" onclick="SkillNestApp.openVerifiedProject('${work.id}')">View Project</button>
          <button class="btn secondary small" type="button" onclick="SkillNestApp.shareVerifiedWork('${work.id}')">Share</button>
        </div>
      </article>
    `;
  }

  function recentVerifiedWorkSection() {
    return `
      <section class="section recent-verified-section">
        <div class="section-head compact-head">
          <div>
            <div class="section-label">Recently completed</div>
            <h2>Verified Results</h2>
          </div>
          <a class="btn secondary small" href="#verified-work">View all</a>
        </div>
        <div class="recent-verified-list">
          ${completedHatches.slice(0, 3).map((work) => `
            <article>
              <strong>${escapeHtml(work.title)}</strong>
              <span>${escapeHtml(visibleOperatorName(work))} · ${escapeHtml(visibleEarnings(work))} · ${escapeHtml(visibleCompletionTime(work))}</span>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  // The delivered result the Operator actually handed in (submission message +
  // links/files), shown on the verified project detail when a client chose to
  // publish it. Mirrors the attachment rendering used in reviewWorkModal.
  function verifiedDeliverableSection(submission) {
    if (!submission) return "";
    const attachments = Array.isArray(submission.attachments) ? submission.attachments : [];
    return `
      <h2>Delivered result</h2>
      <p>${escapeHtml(submission.message || "The Operator's delivered work was approved by the client.")}</p>
      ${attachments.length ? `
        <div class="detail-file-list">
          ${attachments.map((item) => item.kind === "link" || (!item.objectUrl && item.url) ? `
            <article>
              <strong>${escapeHtml(item.name || item.url || "Link")}</strong>
              <span>Link</span>
              <div class="detail-file-actions">
                <a class="btn ghost small" href="${escapeHtml(item.url || item.name)}" target="_blank" rel="noopener">Open</a>
              </div>
            </article>
          ` : `
            <article>
              <strong>${escapeHtml(item.name || "File")}</strong>
              <span>${escapeHtml(item.type || "file")}${item.size ? ` · ${Math.ceil(item.size / 1024)} KB` : ""}</span>
              <div class="detail-file-actions">
                ${item.objectUrl ? `<a class="btn ghost small" href="${escapeHtml(item.objectUrl)}" download="${escapeHtml(item.name || "file")}">Download</a>` : `<span class="file-unavailable">Preview unavailable</span>`}
              </div>
            </article>
          `).join("")}
        </div>
      ` : `<p class="muted-text">No files or links were attached.</p>`}
    `;
  }

  function verifiedProjectDetail(work) {
    const profile = operatorForWork(work);
    const completedByName = work.showProfile
      ? (profile?.name || work.operatorName || "Completed by private Operator")
      : "Completed by private Operator";
    const completedByMeta = work.showProfile
      ? (profile ? `${profile.level} · ${profile.specialization}` : (work.operatorMeta || "Verified Operator"))
      : "Profile hidden for this completed Hatch";
    const completedByInitials = profile?.initials || work.operatorInitials || "H";
    return modal(`
      <div class="detail-head">
        <span class="level-ribbon">${escapeHtml(work.level)}</span>
        ${(work.verifiedBadges || []).map((badge) => tag(badge, "verified-tag")).join("")}
      </div>
      <h1>${escapeHtml(work.title)}</h1>
      <strong class="detail-budget">${escapeHtml(visibleEarnings(work))}</strong>
      <div class="detail-grid">
        <div><span>Industry</span><strong>${escapeHtml(work.industry)}</strong></div>
        <div><span>Completed</span><strong>${escapeHtml(visibleCompletionTime(work))}</strong></div>
        <div><span>Rating</span><strong>${escapeHtml(work.rating)}</strong></div>
        <div><span>Level</span><strong>${escapeHtml(work.level)}</strong></div>
      </div>
      <h2>Client context</h2>
      <p>${escapeHtml(work.clientContext)}</p>
      <h2>Objective</h2>
      <p>${escapeHtml(work.objective)}</p>
      ${work.scope?.length ? `
        <h2>Scope of work</h2>
        <ul class="clean-list">${work.scope.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ` : ""}
      ${work.deliverables?.length ? `
        <h2>Deliverables</h2>
        <ul class="clean-list checklist-list">${work.deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ` : ""}
      ${verifiedDeliverableSection(work.submission)}
      <h2>Outcome</h2>
      <p>${escapeHtml(work.outcome)}</p>
      <h2>Completed by</h2>
      <div class="completed-by detail-completed-by">
        <div class="avatar">${escapeHtml(completedByInitials)}</div>
        <div>
          <strong>${escapeHtml(completedByName)}</strong>
          <p>${escapeHtml(completedByMeta)}</p>
        </div>
      </div>
      ${work.showProfile && profile ? `<button class="btn primary full" type="button" onclick="SkillNestApp.openVerifiedOperatorProfile('${profile.id}')">View Operator Profile</button>` : ""}
    `);
  }

  function verifiedOperatorProfile(profile) {
    const recent = completedHatches.filter((work) => profile.recentWorkIds.includes(work.id));
    return modal(`
      <div class="operator-head detail-operator-head">
        <div class="avatar">${escapeHtml(profile.initials)}</div>
        <div>
          <h1>${escapeHtml(profile.name)}</h1>
          <p>${escapeHtml(profile.level)} · ${escapeHtml(profile.specialization)}</p>
        </div>
      </div>
      <div class="detail-grid proof-grid">
        <div><span>Rating</span><strong>${escapeHtml(profile.rating)}</strong></div>
        <div><span>Completed</span><strong>${escapeHtml(profile.completedCount)} Hatches</strong></div>
        <div><span>Joined</span><strong>${escapeHtml(profile.joinedAt)}</strong></div>
        <div><span>Average completion</span><strong>${escapeHtml(profile.averageCompletion)}</strong></div>
        <div><span>Total earned</span><strong>${escapeHtml(profile.totalEarned)}</strong></div>
      </div>
      <h2>Verified skills</h2>
      <div class="tag-row">${profile.skills.map((item) => tag(item)).join("")}</div>
      <h2>Common industries</h2>
      <div class="tag-row">${profile.industries.map((item) => tag(item)).join("")}</div>
      <h2>Recent verified results</h2>
      <div class="verified-work-list compact-work-list">
        ${recent.map((work) => `
          <article>
            <strong>${escapeHtml(work.title)}</strong>
            <span>${escapeHtml(visibleEarnings(work))} · ${escapeHtml(visibleCompletionTime(work))} · ${escapeHtml(work.rating)}</span>
          </article>
        `).join("")}
      </div>
    `);
  }

  function modal(content) {
    return `
      <div class="modal-backdrop" onclick="SkillNestApp.closeModal()">
        <section class="modal-panel" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <button class="modal-close" type="button" onclick="SkillNestApp.closeModal()">Close</button>
          ${content}
        </section>
      </div>
    `;
  }

  // First-visit language gate. Shown before any language has been chosen, so
  // both the prompt and the dismiss affordance are bilingual — a Chinese
  // speaker shouldn't need English literacy to pick 中文. Dismissing without
  // choosing (backdrop click) is treated as "stay on the default", same as
  // picking English, so the gate never nags on a later visit.
  function languageGateModal() {
    const languages = window.HatchI18n?.languages() || [];
    return `
      <div class="modal-backdrop" onclick="SkillNestApp.dismissLanguageGate()">
        <section class="modal-panel narrow language-gate" role="dialog" aria-modal="true" aria-label="Choose your language / 选择语言" onclick="event.stopPropagation()">
          <h2>Choose your language<br>选择语言</h2>
          <p>You can change this anytime in settings.<br>之后可以随时在设置中更改。</p>
          <div class="language-gate-options">
            ${languages.map((lang) => `
              <button class="language-gate-option" type="button" onclick="SkillNestApp.chooseInitialLanguage('${lang.code}')">${escapeHtml(lang.native)}</button>
            `).join("")}
          </div>
        </section>
      </div>
    `;
  }

  function scopeForTask(task, category) {
    const title = `${task.title || ""} ${task.description || ""}`.toLowerCase();
    if (category === "Website" || title.includes("website")) {
      return ["Write homepage copy", "Create page structure", "Include service sections", "Add booking/contact CTA", "Make it mobile-friendly", "Prepare final handoff notes"];
    }
    if (category === "Content" || title.includes("instagram")) {
      return ["Review source material", "Create content angles", "Write captions or post copy", "Organize posts into a usable plan", "Include light publishing notes"];
    }
    if (category === "Operations" || title.includes("workflow")) {
      return ["Map the current process", "Create the form or sheet structure", "Define the handoff steps", "Add simple tracking notes", "Document how to use it"];
    }
    if (category === "Customer Support" || title.includes("faq") || title.includes("reply")) {
      return ["Review common questions", "Group replies by situation", "Write clear response templates", "Add tone and escalation notes"];
    }
    if (title.includes("menu")) {
      return ["Review menu items", "Clean up item descriptions", "Organize categories", "Prepare editable menu copy or layout notes"];
    }
    return ["Review the client brief", "Create a first usable version", "Organize the work clearly", "Prepare final handoff notes"];
  }

  function deliverablesForTask(task, category) {
    if (Array.isArray(task.deliverables) && task.deliverables.length >= 4) return task.deliverables;
    const title = `${task.title || ""} ${task.description || ""}`.toLowerCase();
    const base = Array.isArray(task.deliverables) ? task.deliverables : [];
    const fallback = category === "Website" || title.includes("website")
      ? ["Homepage layout draft", "Website copy", "Service section content", "Contact/booking section", "Mobile-friendly structure", "Final editable file or implementation notes"]
      : category === "Content"
        ? ["Content ideas", "Captions or copy", "Posting plan", "Hashtag or format notes", "Editable handoff document"]
        : category === "Operations"
          ? ["Workflow outline", "Form or sheet structure", "Process notes", "Final setup instructions"]
          : ["First usable version", "Clear delivery notes", "Editable final file or handoff notes"];
    return [...new Set([...base, ...fallback])].slice(0, 7);
  }

  function missingInfoForTask(task, category, files = [], references = []) {
    const text = `${task.title || ""} ${task.description || ""} ${task.objective || ""}`.toLowerCase();
    const missing = [];
    if (category === "Website" || text.includes("website")) {
      if (!references.some((item) => /business name/i.test(item))) missing.push("business name");
      if (!files.some((file) => /logo|photo/i.test(file.materialType || file.name || ""))) missing.push("logo or photos");
      if (!references.some((item) => /booking|contact|link/i.test(item))) missing.push("booking or contact link");
      missing.push("preferred colors or style");
    } else if (category === "Content" || text.includes("instagram")) {
      if (!files.length) missing.push("source menu, product list, or examples");
      missing.push("preferred tone");
      missing.push("posting frequency");
    } else if (category === "Operations") {
      if (!files.length) missing.push("current process or sample sheet");
      missing.push("tools currently used");
    }
    return [...new Set(missing)].slice(0, 5);
  }

  function levelReason(level, category) {
    if (level === "L1") return "Recommended level: L1 — this is a simple support task with clear outputs and low setup risk.";
    if (level === "L2") return `Recommended level: L2 — this requires practical ${String(category || "business").toLowerCase()} judgment and client-facing execution.`;
    if (level === "L3") return "Recommended level: L3 — this involves setup, workflow logic, or stronger technical judgment.";
    return "Recommended level: L4 — this would require advanced strategy or specialist oversight.";
  }

  function clientContextForTask(task, category) {
    const business = task.business || task.industry || "client";
    if (category === "Website") return `The client runs a ${business.toLowerCase()} and wants a simple website that explains the offer, key details, and next steps for customers.`;
    if (category === "Content") return `The client needs practical content that can be published consistently without starting from a blank page each time.`;
    if (category === "Operations") return `The client wants to make a repeated admin process easier to track and hand off.`;
    if (category === "Customer Support") return `The client wants clearer replies for common customer questions so responses are faster and more consistent.`;
    return `The client runs a ${business.toLowerCase()} and needs a practical Hatch completed with clear handoff notes.`;
  }

  function taskDetail(task) {
    const status = statusInfo(task.status);
    const isOpen = status.label === "New Hatch";
    const isHatched = status.label === "Hatched";
    const category = task.category || task.industry;
    const completion = task.estimatedCompletion || task.timeline;
    const files = Array.isArray(task.files) ? task.files : [];
    const references = Array.isArray(task.references) ? task.references : [];
    const detailObjective = task.objective || task.description || suggestedObjective(`${task.title || ""} ${task.description || ""}`, task.industry || task.business || "", category);
    const introText = task.description && task.description !== detailObjective ? task.description : "";
    const scope = Array.isArray(task.scope) && task.scope.length ? task.scope : scopeForTask(task, category);
    const deliverables = deliverablesForTask(task, category);
    const missingInfo = Array.isArray(task.missingInfo) && task.missingInfo.length ? task.missingInfo : missingInfoForTask(task, category, files, references);
    const isPostedClientTask = String(task.id || "").startsWith("hatch-") || String(task.id || "").startsWith("posted-");
    // Real backend hatch posted by someone else, viewed with a live backend
    // session: offer a direct line to the poster (opens the messaging
    // compose). The token check matters — a logged-out browser still holds a
    // stale skillnestAccount, and /api/messages/start would just 401.
    const viewerAccount = readLocalJson("skillnestAccount", {});
    const canMessagePoster = Boolean(
      task.backendId && task.createdByUsername && viewerAccount.username
      && localStorage.getItem("skillnestLoggedIn") === "true"
      && localStorage.getItem("hatchAuthToken")
      && task.createdByUsername !== viewerAccount.username,
    );
    return modal(`
      <div class="detail-head">
        <span class="level-ribbon">${task.level}</span>
        ${statusBadge(task.status)}
      </div>
      <h1>${escapeHtml(task.title)}</h1>
      <strong class="detail-budget">${escapeHtml(task.budget)}</strong>
      ${introText ? `<p>${escapeHtml(introText)}</p>` : ""}
      <div class="detail-grid">
        <div><span>Business</span><strong>${escapeHtml(task.business)}</strong></div>
        <div><span>Category</span><strong>${escapeHtml(category)}</strong></div>
        <div><span>Estimated completion</span><strong>${escapeHtml(completion)}</strong></div>
        <div><span>Level</span><strong>${escapeHtml(task.level)}</strong></div>
      </div>
      <h2>Client context</h2>
      <p>${escapeHtml(task.clientContext || clientContextForTask(task, category))}</p>
      <h2>Client objective</h2>
      <p>${escapeHtml(detailObjective)}</p>
      <h2>Scope of work</h2>
      <ul class="clean-list">${scope.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <h2>Expected outputs</h2>
      <ul class="clean-list checklist-list">${deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ${missingInfo.length ? `
        <h2>Missing information</h2>
        <ul class="missing-list">${missingInfo.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ` : ""}
      <h2>Recommended Operator level</h2>
      <p>${escapeHtml(levelReason(task.level, category))}</p>
      <h2>Files and references</h2>
      ${files.length || references.length ? `
        <div class="detail-file-list">
          ${files.map((file, index) => `
            <article>
              <strong>${escapeHtml(file.name || file)}</strong>
              <span>${escapeHtml(file.materialType || "File")} · ${escapeHtml(file.type || "file")}${file.size ? ` · ${Math.ceil(file.size / 1024)} KB` : ""}</span>
              <div class="detail-file-actions">
                ${file.objectUrl ? `<button class="btn ghost small" type="button" onclick="SkillNestApp.previewTaskFile('${task.id}', ${index})">Preview</button>` : `<span class="file-unavailable">Preview unavailable after reload</span>`}
                ${file.objectUrl ? `<button class="btn ghost small" type="button" onclick="SkillNestApp.downloadTaskFile('${task.id}', ${index})">Download</button>` : ""}
                ${isPostedClientTask ? `<button class="btn ghost small danger" type="button" onclick="SkillNestApp.removePostedTaskFile('${task.id}', ${index})">Remove</button>` : ""}
              </div>
            </article>
          `).join("")}
          ${references.filter((item) => !String(item || "").startsWith("Attached file:")).map((item) => `
            <article>
              <strong>${escapeHtml(item)}</strong>
              <span>Reference note</span>
            </article>
          `).join("")}
        </div>
      ` : `<p class="muted-text">No files or references attached.</p>`}
      ${canMessagePoster ? `
        <div class="task-actions modal-actions">
          <button class="btn secondary full" type="button" onclick="SkillNestApp.openNewMessageForTask('${task.id}')">✉️ Message ${escapeHtml(task.createdByUsername)}</button>
        </div>
      ` : ""}
      ${isHatched ? `
        <p class="muted-text completion-note">This Hatch has already been completed.</p>
      ` : `
        <div class="task-actions modal-actions">
          <button class="btn secondary full" type="button" onclick="SkillNestApp.saveMission('${task.id}', 'Saved'); SkillNestApp.closeModal();">Save Hatch</button>
          <button class="btn primary full" type="button" ${isOpen ? `onclick="SkillNestApp.saveMission('${task.id}', 'Incubating'); SkillNestApp.closeModal();"` : "disabled"}>${isOpen ? "Apply to Hatch" : "Not currently open"}</button>
        </div>
      `}
    `);
  }

  // Renders the list of files/links an Operator has staged for a submission.
  // Used inside submitWorkModal and refreshed live as files are attached.
  function submissionAttachmentList(files = []) {
    if (!files.length) return `<p class="muted-text small">No files attached yet.</p>`;
    return `
      <div class="submission-attachments">
        ${files.map((file, index) => `
          <article class="submission-attachment">
            <div>
              <strong>${escapeHtml(file.name || "File")}</strong>
              <span>${escapeHtml(file.type || "file")}${file.size ? ` · ${Math.ceil(file.size / 1024)} KB` : ""}</span>
            </div>
            <button class="btn ghost small danger" type="button" onclick="SkillNestApp.removeSubmissionFile(${index})">Remove</button>
          </article>
        `).join("")}
      </div>
    `;
  }

  function submitWorkModal(mission) {
    return modal(`
      <div class="detail-head">
        <span class="level-ribbon">${escapeHtml(mission.level || "L1")}</span>
        ${statusBadge(mission.status)}
      </div>
      <h1>Submit your work</h1>
      <p class="muted-text">${escapeHtml(mission.title || "")}</p>
      <form class="form-card submission-form" onsubmit="SkillNestApp.submitWork(event, '${mission.id}')">
        <label class="field">
          <span>What did you deliver?</span>
          <textarea id="submissionMessage" rows="5" placeholder="Summarize the work, what's included, and anything the client should know." required></textarea>
        </label>
        <label class="field">
          <span>Links <span class="muted-text small">(optional — one per line)</span></span>
          <textarea id="submissionLinks" rows="2" placeholder="https://drive.google.com/...&#10;https://figma.com/..."></textarea>
        </label>
        <label class="field">
          <span>Files <span class="muted-text small">(optional — up to 3 MB each)</span></span>
          <input type="file" multiple onchange="SkillNestApp.handleSubmissionFiles(event)" />
        </label>
        <div id="submissionAttachments">${submissionAttachmentList([])}</div>
        <div class="task-actions modal-actions">
          <button class="btn secondary full" type="button" onclick="SkillNestApp.closeModal()">Cancel</button>
          <button class="btn primary full" type="submit">Submit for review</button>
        </div>
      </form>
    `);
  }

  function reviewWorkModal(task, submission) {
    const attachments = Array.isArray(submission?.attachments) ? submission.attachments : [];
    const statusLabel = submission?.status && submission.status !== "pending"
      ? `<span class="status-pill status-${submission.status === "approved" ? "hatched" : "incubating"}">${submission.status === "approved" ? "Approved" : "Changes requested"}</span>`
      : "";
    return modal(`
      <div class="detail-head">
        <span class="level-ribbon">${escapeHtml(task.level || "L1")}</span>
        ${statusBadge(task.status)}
      </div>
      <h1>Review submitted work</h1>
      <p class="muted-text">${escapeHtml(task.title || "")}</p>
      ${submission ? `
        <h2>Deliverable ${statusLabel}</h2>
        <p>${escapeHtml(submission.message || "No message provided.")}</p>
        <h2>Attachments</h2>
        ${attachments.length ? `
          <div class="detail-file-list">
            ${attachments.map((item) => item.kind === "link" || (!item.objectUrl && item.url) ? `
              <article>
                <strong>${escapeHtml(item.name || item.url || "Link")}</strong>
                <span>Link</span>
                <div class="detail-file-actions">
                  <a class="btn ghost small" href="${escapeHtml(item.url || item.name)}" target="_blank" rel="noopener">Open</a>
                </div>
              </article>
            ` : `
              <article>
                <strong>${escapeHtml(item.name || "File")}</strong>
                <span>${escapeHtml(item.type || "file")}${item.size ? ` · ${Math.ceil(item.size / 1024)} KB` : ""}</span>
                <div class="detail-file-actions">
                  ${item.objectUrl ? `<a class="btn ghost small" href="${escapeHtml(item.objectUrl)}" download="${escapeHtml(item.name || "file")}">Download</a>` : `<span class="file-unavailable">Preview unavailable</span>`}
                </div>
              </article>
            `).join("")}
          </div>
        ` : `<p class="muted-text">No attachments were included.</p>`}
        ${submission.feedback ? `<h2>Your feedback</h2><p>${escapeHtml(submission.feedback)}</p>` : ""}
        ${task.status === "Hatched" ? `
          <p class="muted-text completion-note">This Hatch has been approved and is complete.</p>
        ` : `
          <label class="field">
            <span>Feedback <span class="muted-text small">(optional — sent to the Operator)</span></span>
            <textarea id="reviewFeedback" rows="3" placeholder="What looks good, or what needs changing?"></textarea>
          </label>
          <label class="review-publish-check">
            <input type="checkbox" id="reviewPublish" checked />
            <span>Add to <strong>Verified Results</strong> — let people see this project and the delivered result. <span class="muted-text small">(only applies when you approve)</span></span>
          </label>
          <div class="task-actions modal-actions">
            <button class="btn secondary full" type="button" onclick="SkillNestApp.reviewWork('${task.id}', 'reject')">Request changes</button>
            <button class="btn primary full" type="button" onclick="SkillNestApp.reviewWork('${task.id}', 'approve')">Approve &amp; complete</button>
          </div>
        `}
      ` : `<p class="muted-text">No work has been submitted for this Hatch yet.</p>`}
    `);
  }

  function operatorDetail(operator) {
    return modal(`
      <div class="operator-head detail-operator-head">
        <div class="avatar">${operator.initials}</div>
        <div>
          <h1>${escapeHtml(operator.name)}</h1>
          <p>${escapeHtml(operator.level)}</p>
        </div>
      </div>
      <p>${escapeHtml(operator.bio)}</p>
      <div class="metric-grid">
        <div><strong>${operator.completed}</strong><span>hatched</span></div>
        <div><strong>${operator.rating}</strong><span>rating</span></div>
        <div><strong>${operator.onTime}</strong><span>on-time</span></div>
      </div>
      <div class="tag-row">${operator.industries.map((item) => tag(item)).join("")}</div>
      <div class="task-actions modal-actions">
        <button class="btn primary full" type="button" onclick="SkillNestApp.messageOperator('${operator.id}')">✉️ Message <span data-no-i18n>${escapeHtml(operator.name)}</span></button>
      </div>
      <div class="operator-tabs">
        <button class="tab active" type="button" onclick="SkillNestApp.showOperatorTab(event, 'offers')">Offers</button>
        <button class="tab" type="button" onclick="SkillNestApp.showOperatorTab(event, 'industries')">Industries</button>
        <button class="tab" type="button" onclick="SkillNestApp.showOperatorTab(event, 'tools')">Tools</button>
      </div>
      <div class="tab-panel show" data-tab-panel="offers">
        <div class="offer-list">
          ${operator.offers.map((offer) => `
            <article>
              <strong>${escapeHtml(offer.title)}</strong>
              <span>${escapeHtml(offer.industry)} · ${escapeHtml(offer.level)} · ${escapeHtml(offer.status)}</span>
            </article>
          `).join("")}
        </div>
      </div>
      <div class="tab-panel" data-tab-panel="industries">
        <div class="tag-row">${operator.industries.map((item) => tag(item)).join("")}</div>
      </div>
      <div class="tab-panel" data-tab-panel="tools">
        <div class="tag-row">${operator.tools.map((item) => tag(item)).join("")}</div>
      </div>
    `);
  }

  // ── Messaging components ─────────────────────────────────────────────────

  function formatMessageTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
  }

  function messageFirstLine(text = "") {
    return String(text).split("\n")[0];
  }

  function conversationDisplayName(conversation) {
    if (conversation.kind === "system") return "Hatch";
    const other = conversation.participants?.[0];
    return other?.name || other?.username || "Former user";
  }

  function conversationAvatar(conversation, className = "avatar-md") {
    if (conversation.kind === "system") return systemAvatar(className);
    return userAvatar(conversation.participants?.[0] || {}, className);
  }

  function conversationItem(conversation, activeId) {
    const last = conversation.lastMessage;
    const preview = last
      ? `${last.fromMe ? "You: " : ""}${messageFirstLine(last.body)}`
      : "No messages yet";
    const unread = conversation.unreadCount || 0;
    return `
      <button class="conversation-item ${conversation.id === activeId ? "active" : ""} ${unread ? "has-unread" : ""}" type="button" onclick="SkillNestApp.openConversation(${Number(conversation.id)})">
        ${conversationAvatar(conversation, "avatar-md")}
        <span class="conversation-copy">
          <span class="conversation-top">
            <strong>${escapeHtml(conversationDisplayName(conversation))}</strong>
            <time>${escapeHtml(last ? formatMessageTime(last.createdAt) : "")}</time>
          </span>
          <span class="conversation-preview">${escapeHtml(preview)}</span>
          ${conversation.hatchId ? `<span class="conversation-hatch-tag">🥚 ${escapeHtml(conversation.hatchTitle || "Removed Hatch")}</span>` : ""}
        </span>
        ${unread ? `<span class="conversation-unread">${unread > 9 ? "9+" : unread}</span>` : ""}
      </button>
    `;
  }

  // System messages render as a distinct centered card (Hatch mark, bold
  // first line); user messages are chat bubbles, mine right, theirs left.
  function messageBubble(message) {
    if (message.system) {
      const lines = String(message.body || "").split("\n");
      const rest = lines.slice(1).join("\n").trim();
      return `
        <article class="msg-row system">
          <div class="msg-system-card">
            <span class="msg-system-source">${systemAvatar("avatar-xs")} Hatch</span>
            <strong>${escapeHtml(lines[0])}</strong>
            ${rest ? `<p>${escapeHtml(rest)}</p>` : ""}
            <time>${escapeHtml(formatMessageTime(message.createdAt))}</time>
          </div>
        </article>
      `;
    }
    return `
      <article class="msg-row ${message.fromMe ? "mine" : "theirs"}">
        ${message.fromMe ? "" : userAvatar(message.sender || {}, "avatar-sm")}
        <div class="msg-bubble">
          <p>${escapeHtml(message.body)}</p>
          <time>${escapeHtml(formatMessageTime(message.createdAt))}</time>
        </div>
      </article>
    `;
  }

  // Compose modal for starting a conversation. Three shapes: blank (type a
  // username), recipient preset (from a "Message X" button), or hatch-only —
  // no recipient field at all, the server resolves the other party.
  // Rows for the new-message recipient typeahead: a profile avatar, the
  // person's name with their @handle, and the tools they use underneath.
  // onmousedown is cancelled so clicking a row doesn't blur (and hide) the
  // input before the click registers.
  function messageSuggestionList(people = []) {
    return people.map((person) => `
      <button type="button" class="mention-option" role="option" aria-selected="false" data-id="${escapeHtml(person.id)}"
        onmousedown="event.preventDefault()" onclick="SkillNestApp.pickMessageRecipient('${escapeHtml(person.id)}')">
        <span class="mention-avatar" aria-hidden="true">${escapeHtml(person.initials || avatarInitials({ name: person.name }))}</span>
        <span class="mention-body">
          <span class="mention-name">${escapeHtml(person.name)}<span class="mention-handle">@${escapeHtml(person.id)}</span></span>
          ${Array.isArray(person.tools) && person.tools.length
            ? `<span class="mention-tools">${person.tools.slice(0, 4).map((tool) => `<span class="mention-tool">${escapeHtml(tool)}</span>`).join("")}</span>`
            : ""}
        </span>
      </button>
    `).join("");
  }

  function newMessageModal(preset = {}) {
    const lockTo = Boolean(preset.to);
    const resolveFromHatch = Boolean(preset.hatchId && !preset.to);
    return modal(`
      <h1 class="new-message-title">New message</h1>
      ${preset.hatchTitle ? `<p class="muted-text">About the Hatch: ${escapeHtml(preset.hatchTitle)}</p>` : ""}
      <form class="form-card new-message-form" onsubmit="SkillNestApp.sendNewMessage(event)">
        <input type="hidden" id="newMessageHatchId" value="${escapeHtml(preset.hatchId || "")}" />
        ${resolveFromHatch
          ? `<p class="new-message-note">To: the other person on this Hatch</p>`
          : `
            <label class="field">
              <span>To${lockTo ? "" : " (name or @username)"}</span>
              <div class="mention-field">
                <input id="newMessageTo" type="text" autocomplete="off"
                  placeholder="${lockTo ? "username" : "Search by name or @username"}"
                  value="${escapeHtml(preset.to || "")}" ${lockTo ? "readonly" : ""} required
                  role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="newMessageSuggestions"
                  ${lockTo ? "" : `oninput="SkillNestApp.onRecipientInput()" onkeydown="SkillNestApp.onRecipientKeydown(event)" onblur="SkillNestApp.onRecipientBlur()"`} />
                <div class="mention-menu" id="newMessageSuggestions" role="listbox" hidden></div>
              </div>
            </label>
          `}
        <label class="field full-field">
          <span>Message</span>
          <textarea id="newMessageBody" rows="4" placeholder="Write your message..." required></textarea>
        </label>
        <div class="task-actions modal-actions">
          <button class="btn secondary full" type="button" onclick="SkillNestApp.closeModal()">Cancel</button>
          <button class="btn primary full" type="submit">Send</button>
        </div>
      </form>
    `);
  }

  // Footer language control: a quiet button showing the active language that
  // opens a small popover to switch. Marked data-no-i18n so the language names
  // always render in their own language rather than the active one.
  function languagePicker() {
    const I18n = window.HatchI18n;
    if (!I18n) return "";
    const active = I18n.getLang();
    const options = I18n.languages()
      .map((lang) => `
        <button class="language-option ${lang.code === active ? "active" : ""}" type="button" role="menuitemradio" aria-checked="${lang.code === active}" onclick="SkillNestApp.chooseLanguage('${lang.code}')">
          <span class="language-option-name">${escapeHtml(lang.native)}</span>
          ${lang.code === active ? `<span class="language-option-check" aria-hidden="true">✓</span>` : ""}
        </button>
      `)
      .join("");
    return `
      <div class="language-picker">
        <button class="language-button" type="button" id="languageButton" aria-haspopup="menu" aria-expanded="false" onclick="SkillNestApp.toggleLanguageMenu(event)">
          <span class="language-globe" aria-hidden="true">🌐</span>
          <span>${escapeHtml(I18n.languageOf(active).native)}</span>
          <span class="language-caret" aria-hidden="true">▴</span>
        </button>
        <div class="language-menu" id="languageMenu" role="menu" hidden>${options}</div>
      </div>
    `;
  }

  function footer(isLoggedIn, account = {}) {
    const profileLink = isLoggedIn ? `<a href="#profile">My Hatches</a>` : `<a href="#auth">Sign up / Log in</a>`;
    // Operators already reach the levels/ranking content through "About Hatch"
    // below, so they don't get a second link to the same page under a
    // different label — only non-Operators get the distinct "apply" CTA.
    const isOperator = isLoggedIn && /operator|operator/i.test(String(account.role || ""));
    const operatorLink = isOperator ? "" : `<a href="#operator">Become an Operator</a>`;
    return `
      <footer class="footer">
        <div class="footer-inner">
          <div>
            <strong>Hatch</strong>
            <p>AI-powered Hatches for real business work.</p>
          </div>
          <div class="footer-links">
            <button class="theme-switch" type="button" role="switch" onclick="SkillNestApp.toggleDarkMode()" aria-checked="${document.documentElement.classList.contains("dark-mode")}" aria-label="${document.documentElement.classList.contains("dark-mode") ? "Switch to light mode" : "Switch to dark mode"}">
              <span class="theme-switch-track" aria-hidden="true">
                <span class="theme-switch-glyph sun">☀</span>
                <span class="theme-switch-glyph moon">☾</span>
                <span class="theme-switch-thumb">
                  <span class="theme-switch-thumb-icon sun">☀</span>
                  <span class="theme-switch-thumb-icon moon">☾</span>
                </span>
              </span>
            </button>
            <a href="#create-hatch" onclick="SkillNestApp.startNewHatch()">Post a Hatch</a>
            <a href="#browse">Browse Hatches</a>
            <a href="#operators">Find Operators</a>
            <a href="#clients">Browse Clients</a>
            <a href="#verified-work">Verified Results</a>
            ${operatorLink}
            <a href="#about">About Hatch</a>
            ${profileLink}
            <a href="#terms">Terms &amp; Conditions</a>
            <a href="#privacy">Privacy Policy</a>
          </div>
        </div>
        <div class="footer-bottom">
          ${languagePicker()}
        </div>
      </footer>
    `;
  }

  return {
    conversationAvatar,
    conversationDisplayName,
    conversationItem,
    footer,
    formatMessageTime,
    languageBadge,
    languageGateModal,
    languagePicker,
    taskLanguageState,
    messageBubble,
    newMessageModal,
    messageSuggestionList,
    hero,
    taskComposer,
    hatchLifecycleSection,
    messagingFeatureSection,
    whyHatchSection,
    recentlyHatchedSection,
    recentVerifiedWorkSection,
    modal,
    nav,
    statsBanner,
    operatorDirectoryCard,
    operatorLevelBucket,
    operatorMatchScore,
    clientDirectoryCard,
    clientMatchScore,
    clientCard,
    clientDetail,
    recommendedClients,
    operatorCard,
    operatorDetail,
    recommendedOperators,
    budgetSortValue,
    completionSortValue,
    levelSortValue,
    formatRangeValue,
    rangeFilterMarkup,
    taskCard,
    taskDetail,
    submitWorkModal,
    reviewWorkModal,
    submissionAttachmentList,
    taskPreviewMarkup,
    verifiedOperatorProfile,
    verifiedProjectDetail,
    verifiedWorkCard,
  };
})());
