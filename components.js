window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  // Provided by components/primitives.js, components/local-brief-fallback.js,
  // components/intake-wizard-ui.js, and components/detail-views.js, all
  // loaded just before this file.
  const {
    escapeHtml, tag, avatarInitials, userAvatar, systemAvatar, statusInfo, statusBadge,
    field, selectField, textAreaField, choiceField, sentenceTitle, cleanSentence, normalizeTaskText,
    isLowQualityProjectInput, generateTaskBrief, isProjectReady, projectReadiness, understandingStatement,
    nextClarification, fallbackAssistantMessage, buildTaskBrief, taskBriefPreviewMarkup, suggestedObjective,
    readLocalJson, modal,
  } = window.SkillNestComponents;

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
    languagePicker,
    messageBubble,
    newMessageModal,
    messageSuggestionList,
  };
})());
