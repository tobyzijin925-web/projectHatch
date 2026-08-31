// Split out of components.js: top-level page chrome and homepage marketing
// sections — the nav bar/account menu, the AI-intake hero + task composer,
// the stats banner, and the messaging/why-Hatch/lifecycle/recently-hatched
// homepage sections. Depends on components/primitives.js and
// components/local-brief-fallback.js, both loaded just before this file.
window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  const { hatchedWork } = window.SkillNestData;
  const { escapeHtml, tag, userAvatar, statusBadge, generateTaskBrief, taskBriefPreviewMarkup } = window.SkillNestComponents;

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

  return {
    statsBanner,
    nav,
    taskPreviewMarkup,
    hero,
    taskComposer,
    messagingFeatureSection,
    whyHatchSection,
    hatchLifecycleSection,
    recentlyHatchedSection,
  };
})());
