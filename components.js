window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  // Provided by components/primitives.js, components/local-brief-fallback.js,
  // and components/intake-wizard-ui.js, all loaded just before this file.
  const {
    escapeHtml, tag, avatarInitials, userAvatar, systemAvatar, statusInfo, statusBadge,
    field, selectField, textAreaField, choiceField, sentenceTitle, cleanSentence, normalizeTaskText,
    isLowQualityProjectInput, generateTaskBrief, isProjectReady, projectReadiness, understandingStatement,
    nextClarification, fallbackAssistantMessage, buildTaskBrief, taskBriefPreviewMarkup, suggestedObjective,
    readLocalJson,
  } = window.SkillNestComponents;

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
    languageGateModal,
    languagePicker,
    messageBubble,
    newMessageModal,
    messageSuggestionList,
    modal,
    operatorDetail,
    taskDetail,
    submitWorkModal,
    reviewWorkModal,
    submissionAttachmentList,
  };
})());
