// Split out of components.js: the modal shell and every full-page/modal
// detail view — task detail, submit/review-work modals, and the operator
// detail modal. Depends on components/primitives.js,
// components/local-brief-fallback.js, and components/intake-wizard-ui.js,
// all loaded earlier. modal() is exported (and not just used internally)
// because components.js's remaining messaging functions (newMessageModal)
// still call it.
window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  const { escapeHtml, tag, statusBadge, statusInfo, suggestedObjective, readLocalJson } = window.SkillNestComponents;

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

  return {
    modal,
    languageGateModal,
    taskDetail,
    submissionAttachmentList,
    submitWorkModal,
    reviewWorkModal,
    operatorDetail,
  };
})());
