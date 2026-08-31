// Split out of components.js: the guided-intake wizard UI — the section
// rail/tracker, the compact understanding/quality/operator-questions cards,
// the assistant conversation thread, and the AI debug panel. Depends only on
// components/primitives.js and components/local-brief-fallback.js, both
// loaded just before this file.
window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  const {
    escapeHtml, generateTaskBrief, nextClarification, fallbackAssistantMessage,
    projectReadiness, understandingStatement,
  } = window.SkillNestComponents;

  // The assistant's display name in the chat UI. Change this one value to
  // rename it everywhere it appears to users. (The matching name inside the AI
  // instructions is ASSISTANT_NAME in server.js — update both to keep them in
  // sync.)
  const ASSISTANT_LABEL = "Chickie";

  const builderSections = [
    { id: "title", label: "I understand what you need", short: "Need is understood", prompt: "Here’s how I’d write this.", optional: false },
    { id: "businessType", label: "I know who it is for", short: "Who it is for", prompt: "I think this is who the work is for.", optional: false },
    { id: "summary", label: "I understand the outcome", short: "Outcome is clear", prompt: "Here’s how I’d summarize the goal.", multiline: true, optional: false },
    { id: "deliverables", label: "I know what should be delivered", short: "Outputs are clear", prompt: "Here’s what I think the Operator should create.", multiline: true, list: true, optional: false },
    { id: "suggestedTimeline", label: "Timeline is clear", short: "Timeline is clear", prompt: "Here’s the timeline I’d use for now.", optional: false },
    { id: "suggestedBudget", label: "Budget is clear", short: "Budget is clear", prompt: "Here’s the budget range I’d suggest.", optional: false },
    { id: "industry", label: "Context is clear", short: "Context is clear", prompt: "Here’s the category I’d use for matching.", optional: false },
    { id: "references", label: "Source material is clear", short: "Source material", prompt: "Here’s what I found for references or files.", multiline: true, list: true, optional: true },
    { id: "constraints", label: "Ready for an Operator", short: "Ready for Operator", prompt: "Here’s what I’d note so the work stays on track.", multiline: true, list: true, optional: true },
  ];

  function readLocalJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  function sectionValue(brief, id) {
    const values = {
      title: brief.title,
      businessType: brief.businessType,
      summary: brief.summary,
      deliverables: brief.deliverables || [],
      suggestedTimeline: brief.suggestedTimeline,
      suggestedBudget: brief.suggestedBudget,
      industry: brief.industry,
      references: brief.references || [],
      constraints: brief.constraints || [],
    };
    return values[id];
  }

  function sectionHasValue(brief, section) {
    if (brief.isProcessing) return false;
    if (section.id === "suggestedTimeline") return Boolean(brief.timelineKnown);
    if (section.id === "suggestedBudget") return Boolean(brief.budgetKnown);
    const value = sectionValue(brief, section.id);
    if (Array.isArray(value)) return value.filter(Boolean).length > 0;
    return Boolean(String(value || "").trim());
  }

  function requiredBriefFieldsComplete(brief = {}) {
    const hasText = (value) => String(value || "").trim().length > 0;
    const hasList = (value) => Array.isArray(value) && value.filter(Boolean).length > 0;
    return Boolean(
      hasText(brief.title)
      && hasText(brief.summary)
      && (hasText(brief.clientContext) || hasText(brief.businessType) || hasText(brief.industry))
      && (hasList(brief.scope) || hasList(brief.deliverables))
      && hasList(brief.deliverables)
      && hasText(brief.suggestedBudget)
      && hasText(brief.suggestedTimeline)
    );
  }

  function compactStatus(value, options = {}) {
    if (options.optional && !String(value || "").trim() && !(Array.isArray(value) && value.length)) return "Optional";
    if (options.flexible && /flexible|not sure|no references|none/i.test(String(value || ""))) return "Flexible";
    if (Array.isArray(value)) return value.filter(Boolean).length ? "Understood" : options.optional ? "Optional" : "Still missing";
    return String(value || "").trim() ? "Understood" : options.optional ? "Optional" : "Still missing";
  }

  function understandingSummaryItems(brief = {}, files = []) {
    const ai = brief.understandingSummary || {};
    const deliverableText = Array.isArray(brief.deliverables) && brief.deliverables.length
      ? brief.deliverables.slice(0, 2).join(", ")
      : "";
    const fileText = files.length
      ? `${files.length} file${files.length === 1 ? "" : "s"} attached`
      : Array.isArray(brief.references) && brief.references.length ? brief.references.slice(0, 2).join(", ") : "";
    return [
      { label: "Project", value: ai.project || brief.title || "", status: compactStatus(ai.project || brief.title) },
      { label: "Audience", value: ai.audience || brief.audience || "", status: compactStatus(ai.audience || brief.audience) },
      { label: "Goal", value: ai.goal || brief.summary || "", status: compactStatus(ai.goal || brief.summary) },
      { label: "Deliverables", value: ai.deliverables || deliverableText, status: compactStatus(ai.deliverables || brief.deliverables) },
      { label: "Timeline", value: ai.timeline || brief.suggestedTimeline || "", status: compactStatus(ai.timeline || brief.suggestedTimeline, { flexible: true }) },
      { label: "Budget", value: ai.budget || brief.suggestedBudget || "", status: compactStatus(ai.budget || brief.suggestedBudget, { flexible: true }) },
      { label: "Files / references", value: ai.files || fileText, status: compactStatus(ai.files || fileText, { optional: true, flexible: true }) },
    ];
  }

  function liveUnderstandingCard(brief = {}, files = []) {
    const items = understandingSummaryItems(brief, files);
    return `
      <div class="compact-insight-card live-understanding-card">
        <div class="insight-card-head">
          <h3>Here’s what Hatch understands so far.</h3>
          <p>Compact view only. Hatch still handles the writing.</p>
        </div>
        <div class="understanding-summary-list">
          ${items.map((item) => `
            <article>
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value || "Not added yet")}</strong>
              <em class="${item.status.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(item.status)}</em>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  function qualityLabel(value) {
    const normalized = String(value || "").toLowerCase().replace(/_/g, "-");
    if (normalized.includes("strong")) return "Strong";
    if (normalized.includes("needs")) return "Needs detail";
    return "Good";
  }

  function localQualityCheck(brief = {}) {
    const objective = String(brief.summary || "");
    const title = String(brief.title || "");
    const deliverables = Array.isArray(brief.deliverables) ? brief.deliverables.filter(Boolean) : [];
    const hasTimelineBudget = Boolean(brief.suggestedTimeline && brief.suggestedBudget);
    return {
      clarity: objective.length > 60 && title.length > 18 ? "strong" : objective.length > 28 ? "good" : "needs_detail",
      specificity: /content|website|video|spreadsheet|menu|post|automation|workflow|description/i.test(title + objective) ? "good" : "needs_detail",
      deliverables: deliverables.length >= 3 ? "strong" : deliverables.length ? "good" : "needs_detail",
      timeline_budget: hasTimelineBudget ? "good" : "needs_detail",
    };
  }

  function qualityCheckCard(brief = {}) {
    const check = { ...localQualityCheck(brief), ...(brief.qualityCheck || {}) };
    const rows = [
      ["Clarity", check.clarity],
      ["Specificity", check.specificity],
      ["Deliverables", check.deliverables],
      ["Timeline / budget", check.timeline_budget || check.timelineBudget],
    ];
    const needsDetail = rows.some(([, value]) => qualityLabel(value) === "Needs detail");
    return `
      <div class="compact-insight-card quality-check-card">
        <div class="insight-card-head">
          <h3>${needsDetail ? "This is almost ready." : "This looks ready."}</h3>
          <p>${needsDetail ? "One or two details could make this clearer." : "The brief has enough shape for an Operator to understand it."}</p>
        </div>
        <div class="quality-check-grid">
          ${rows.map(([label, value]) => `
            <article>
              <span>${escapeHtml(label)}</span>
              <strong class="${qualityLabel(value).toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(qualityLabel(value))}</strong>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  function localOperatorQuestions(brief = {}, files = []) {
    const questions = [];
    if (!brief.audience) questions.push("Who is the main audience?");
    if (!Array.isArray(brief.references) || !brief.references.length) questions.push("Do you have brand examples or source material?");
    if (!files.length && (!brief.references || !brief.references.length)) questions.push("Should the Operator use any files, photos, menus, or links?");
    if (!Array.isArray(brief.constraints) || !brief.constraints.length) questions.push("Should the tone be formal, friendly, or something else?");
    if (!brief.suggestedTimeline || /flexible/i.test(brief.suggestedTimeline)) questions.push("Is the timeline flexible?");
    if (!questions.length) questions.push("Should the final version be editable?", "Are there any details the Operator should avoid?");
    return questions.slice(0, 4);
  }

  function operatorQuestionsCard(brief = {}, files = []) {
    const questions = Array.isArray(brief.operatorQuestions) && brief.operatorQuestions.length
      ? brief.operatorQuestions.slice(0, 4)
      : localOperatorQuestions(brief, files);
    return `
      <div class="compact-insight-card operator-questions-card">
        <div class="insight-card-head">
          <h3>An Operator might still ask…</h3>
          <p>You can answer these now or post anyway.</p>
        </div>
        <ul>
          ${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}
        </ul>
        <div class="focused-actions compact-actions">
          <button class="btn secondary small" type="button" onclick="SkillNestApp.continueChattingFromFinal()">Answer these now</button>
          <button class="btn primary small" type="button" onclick="SkillNestApp.submitReviewedHatch()">Post anyway</button>
          <button class="btn ghost small" type="button" onclick="SkillNestApp.saveHatchDraft()">Save draft</button>
        </div>
      </div>
    `;
  }

  // Pure readiness signal: does the AI consider this brief postable? Used by the
  // Review and Post button, which must stay green even after the user dismisses
  // the final-review prompt to keep chatting.
  function briefReadyForReview(brief = {}, activeIndex = 0) {
    const readiness = String(brief.readiness || brief.stage || "").toLowerCase();
    const missingInfo = Array.isArray(brief.missingInfo) ? brief.missingInfo.filter(Boolean) : [];
    const message = String(brief.assistantMessage || "");
    return Boolean(
      activeIndex >= builderSections.length
      || /ready_to_post|ready to post/.test(readiness)
      || brief.canSubmit === true
      || brief.can_submit === true
      || /ready to post|brief is ready|finalize the brief/i.test(message)
      || (brief.isValidProject && missingInfo.length === 0)
      || requiredBriefFieldsComplete(brief)
    );
  }

  function shouldShowFinalReview(brief = {}, activeIndex = 0) {
    if (localStorage.getItem("hatchFinalReviewDismissed") === "true") return false;
    return briefReadyForReview(brief, activeIndex);
  }

  function sectionSummary(brief, section) {
    const value = sectionValue(brief, section.id);
    if (brief.isProcessing) return "Working on it...";
    if (Array.isArray(value)) {
      if (!value.length) return section.optional ? "Can stay flexible" : "Take a look";
      return value.slice(0, 2).join(", ");
    }
    const text = String(value || "").trim();
    if (section.id === "suggestedTimeline" && text && !brief.timelineKnown) return `Suggested: ${text}`;
    if (section.id === "suggestedBudget" && text && !brief.budgetKnown) return `Suggested: ${text}`;
    if (!text) return section.optional ? "Can stay flexible" : "Take a look";
    return text.length > 92 ? `${text.slice(0, 89)}...` : text;
  }

  function sectionLongValue(brief, section) {
    const value = sectionValue(brief, section.id);
    if (brief.isProcessing) return "Working on it...";
    if (Array.isArray(value)) return value.length ? value.join("\n") : "";
    return String(value || "").trim();
  }

  function activeSectionMessage(brief, section) {
    if (brief.isProcessing) return "I’m reading through your project...";
    if (brief.stage === "invalid_input" || brief.isValidProject === false || Number(brief.confidence || 0) < 40) {
      return "Tell me what you need done, who it is for, and what a good result would look like.";
    }
    const value = sectionLongValue(brief, section);
    if (!value && section.optional) return "We can leave this flexible for now, or add it if you already have something in mind.";
    if (!value) return smartQuestionForSection(section);
    return smartQuestionForSection(section, value);
  }

  function smartQuestionForSection(section, value = "") {
    const withValue = Boolean(String(value || "").trim());
    const questions = {
      title: withValue ? "I’ve drafted a project title in the background. What would you call this in your own words?" : "What should we call this Hatch?",
      businessType: withValue ? "I think I understand who this is for. Is there anything specific about the business I should know?" : "Who is this for?",
      summary: withValue ? "I’ve got the main goal. What outcome matters most to you?" : "What outcome are you hoping for?",
      deliverables: withValue ? "I’ve started listing the deliverables. What should the Operator definitely hand over?" : "What should the Operator deliver?",
      suggestedTimeline: withValue ? "I’ve put a timeline in the brief. Should we keep it, or make it flexible?" : "When would you ideally like this finished?",
      suggestedBudget: withValue ? "I’ve added a budget direction. Should we keep that, or leave it flexible?" : "What budget range feels comfortable?",
      industry: withValue ? "I’ve matched this to an industry. Does that category fit?" : "What industry or category does this belong to?",
      references: "Do you have examples, files, or links the Operator should follow?",
      constraints: "Anything the Operator should avoid or keep in mind?",
    };
    return questions[section.id] || "What should Hatch know for this part?";
  }

  function focusedSectionCard(brief, section) {
    const editKey = localStorage.getItem("hatchBriefEditKey");
    const editing = editKey === section.id;
    const inputId = `focused_${section.id}`;
    const value = sectionLongValue(brief, section);
    const hasValue = sectionHasValue(brief, section);
    const messages = readLocalJson("hatchSectionMessages", {})[section.id] || [];
    const editingControl = section.id === "suggestedLevel"
      ? `<select id="${inputId}">${["L1", "L2", "L3", "L4"].map((level) => `<option value="${level}"${value === level ? " selected" : ""}>${level}</option>`).join("")}</select>`
      : section.multiline
        ? `<textarea id="${inputId}" rows="5" placeholder="No worries — tell me what you’d change.">${escapeHtml(value)}</textarea>`
        : `<input id="${inputId}" type="text" value="${escapeHtml(value)}" placeholder="No worries — tell me what you’d change." />`;

    return `
      <article class="focused-section-card">
        <div class="focused-section-top">
          <span class="section-count">Active section</span>
          <h3>${escapeHtml(section.label)}</h3>
        </div>
        <div class="assistant-section-note">
          <p>${escapeHtml(activeSectionMessage(brief, section))}</p>
          ${messages.length ? `<div class="section-message-log">${messages.map((message) => `<span>${escapeHtml(message)}</span>`).join("")}</div>` : ""}
        </div>
        ${brief.isProcessing ? `
          <div class="proposed-brief-text empty">
            <p>Hatch is organizing this section...</p>
          </div>
        ` : editing ? `
          <div class="focused-edit">
            ${editingControl}
            <div class="focused-actions">
              <button class="btn primary" type="button" onclick="SkillNestApp.updateSection('${section.id}', document.getElementById('${inputId}').value)">Save change</button>
              <button class="btn ghost" type="button" onclick="SkillNestApp.cancelBriefEdit()">Cancel</button>
            </div>
          </div>
        ` : `
          <div class="proposed-brief-text ${value ? "" : "empty"}">
            ${section.list && value
              ? `<ul>${value.split(/\n|,/).map((item) => item.trim()).filter(Boolean).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
              : `<p>${escapeHtml(value || (section.optional ? "We can leave this flexible for now." : "Take a look"))}</p>`}
          </div>
          <div class="focused-actions">
            <button class="btn primary" type="button" ${!hasValue && !section.optional ? "disabled" : ""} onclick="SkillNestApp.confirmSection('${section.id}')">Confirm</button>
            <button class="btn secondary" type="button" onclick="SkillNestApp.editSection('${section.id}')">Edit</button>
            <button class="btn secondary" type="button" onclick="SkillNestApp.rewriteSection('${section.id}')">Ask Hatch to rewrite</button>
            ${section.optional ? `<button class="btn ghost" type="button" onclick="SkillNestApp.confirmSection('${section.id}')">Skip for now</button>` : ""}
          </div>
        `}
      </article>
    `;
  }

  function sectionRail(brief, activeIndex, completed) {
    return `
      <div class="section-rail passive-tracker">
        ${builderSections.map((section, index) => {
          const done = completed.includes(section.id);
          const active = index === activeIndex;
          const future = index > activeIndex && !done;
          const hasValue = sectionHasValue(brief, section);
          const status = done ? "Understood" : hasValue ? "Shaping" : future ? "Later" : "Still learning";
          return `
            <article class="section-rail-card ${active ? "active" : ""} ${done ? "done" : ""} ${future ? "future" : ""}">
              <span>${escapeHtml(section.short)}</span>
              <strong>${escapeHtml(sectionSummary(brief, section))}</strong>
              <em>${escapeHtml(status)}</em>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function finalReviewMarkup(brief, files, completed) {
    const showEditor = localStorage.getItem("hatchShowFinalEditSections") === "true";
    const rows = [
      ["Title", brief.title || "Untitled Hatch"],
      ["Client context", brief.clientContext || brief.businessType || brief.industry || "Not specified"],
      ["Objective", brief.summary || "Not specified"],
      ["Scope", Array.isArray(brief.scope) && brief.scope.length ? brief.scope.join(", ") : sectionSummary(brief, { id: "deliverables" })],
      ["Deliverables", Array.isArray(brief.deliverables) && brief.deliverables.length ? brief.deliverables.join(", ") : "Not specified"],
      ["Budget", brief.suggestedBudget || "Flexible"],
      ["Timeline", brief.suggestedTimeline || "Flexible"],
      ["Files / references", Array.isArray(brief.references) && brief.references.length ? brief.references.join(", ") : "No references provided"],
      ["Recommended Operator level", brief.recommendedOperatorType || brief.suggestedLevel || "L1"],
    ];
    return `
      <div class="final-review">
        <div class="final-review-head">
          <span class="readiness-pill">Ready to Post</span>
          <h3>Your Hatch is ready.</h3>
          <p>Review it once, then submit when it looks good.</p>
        </div>
        <div class="final-brief-list">
          ${rows.map(([label, value]) => `
            <article>
              <span>${escapeHtml(label)}</span>
              <p>${escapeHtml(value)}</p>
            </article>
          `).join("")}
          <article>
            <span>Attached files</span>
            ${attachedFilesReviewMarkup(files)}
          </article>
        </div>
        ${qualityCheckCard(brief)}
        ${operatorQuestionsCard(brief, files)}
        <div class="focused-actions">
          <button class="btn primary" type="button" onclick="SkillNestApp.submitReviewedHatch()">Submit Hatch</button>
          <button class="btn secondary" type="button" onclick="SkillNestApp.toggleFinalEditList()">Edit brief</button>
          <button class="btn ghost" type="button" onclick="SkillNestApp.continueChattingFromFinal()">Back to chat</button>
          <button class="btn ghost" type="button" onclick="SkillNestApp.saveHatchDraft()">Save draft</button>
        </div>
        ${showEditor ? `
          <div class="final-edit-list" aria-label="Choose a section to edit">
            ${builderSections.map((section) => `
              <button type="button" onclick="SkillNestApp.editFinalSection('${section.id}')">
                <span>${escapeHtml(section.label)}</span>
                <strong>${escapeHtml(sectionSummary(brief, section))}</strong>
              </button>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }

  function attachedFilesReviewMarkup(files = []) {
    if (!files.length) return `<p>No files attached</p>`;
    return `
      <div class="attached-file-list">
        ${files.map((file, index) => `
          <div class="attached-file-row">
            <p>
              <strong>${escapeHtml(file.name || file)}</strong>
              <small>${escapeHtml(file.materialType || "File")}${file.size ? ` · ${Math.ceil(file.size / 1024)} KB` : ""}</small>
            </p>
            <button class="btn ghost small" type="button" onclick="SkillNestApp.downloadDraftFile(${index})">Download</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  function filePreviewListMarkup(files = [], emptyText = "No files attached yet") {
    if (!files.length) return `<div class="file-preview-empty">${escapeHtml(emptyText)}</div>`;
    const labelOptions = ["Services and prices", "Photos/logo", "Existing website", "Menu/items", "Brand examples", "Notes", "Other material"];
    return files.map((file, index) => {
      const size = file.size ? `${Math.ceil(file.size / 1024)} KB` : "Size unavailable";
      const type = file.type || "file";
      const materialType = file.materialType || "Other material";
      const hasSessionFile = Boolean(file.objectUrl);
      return `
        <article class="file-preview">
          <div>
            <strong>${escapeHtml(file.name || file)}</strong>
            <span>${escapeHtml(type)} · ${size}</span>
            <label class="file-label-control">
              <span>Label</span>
              <select onchange="SkillNestApp.updateDraftFileLabel(${index}, this.value)">
                ${labelOptions.map((option) => `<option value="${escapeHtml(option)}"${option === materialType ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
                ${labelOptions.includes(materialType) ? "" : `<option value="${escapeHtml(materialType)}" selected>${escapeHtml(materialType)}</option>`}
              </select>
            </label>
          </div>
          <div class="file-preview-actions">
            ${hasSessionFile ? `<button class="btn ghost small" type="button" onclick="SkillNestApp.previewDraftFile(${index})">Preview</button>` : ""}
            ${hasSessionFile ? `<button class="btn ghost small" type="button" onclick="SkillNestApp.downloadDraftFile(${index})">Download</button>` : ""}
            ${hasSessionFile ? "" : `<span class="file-unavailable">Session preview unavailable</span>`}
          </div>
          <button class="btn ghost small danger" type="button" onclick="SkillNestApp.removeDraftFile(${index})">Remove</button>
        </article>
      `;
    }).join("");
  }

  function referenceAttachmentMarkup(files = [], materialSuggestions = []) {
    const materialButtons = materialSuggestions.filter((item) => !/no materials/i.test(item));
    const noMaterials = materialSuggestions.find((item) => /no materials/i.test(item));
    return `
      <div class="reference-attachment-panel">
        <div>
          <strong>Attach source files</strong>
          <p>Choose what kind of material you’re adding, then attach the matching files. You can relabel files after upload.</p>
        </div>
        ${materialButtons.length ? `
          <div class="material-type-grid" aria-label="Material types">
            ${materialButtons.map((item) => `
              <button class="material-type-button" type="button" onclick="SkillNestApp.attachReferenceMaterial(decodeURIComponent('${encodeURIComponent(item)}'))">
                ${escapeHtml(item)}
              </button>
            `).join("")}
          </div>
        ` : ""}
        <div class="reference-attachment-actions">
          <button class="tool-button" type="button" onclick="SkillNestApp.attachReferenceMaterial('Other material')">Attach other files</button>
          ${noMaterials ? `<button class="btn ghost small" type="button" onclick="SkillNestApp.sendAssistantReply(decodeURIComponent('${encodeURIComponent(noMaterials)}'))">${escapeHtml(noMaterials)}</button>` : ""}
          <button class="btn secondary small" type="button" ${files.length ? "" : "disabled"} onclick="SkillNestApp.completeReferenceFiles()">Use these files and continue</button>
          <input id="reviewTaskFile" class="hidden-file" type="file" multiple onchange="SkillNestApp.handleTaskFiles(event)" />
        </div>
        <div class="file-preview-list review-file-preview-list" data-file-preview>
          ${filePreviewListMarkup(files)}
        </div>
      </div>
    `;
  }

  function conversationSectionMarkup(brief) {
    const completed = readLocalJson("hatchCompletedSections", []);
    const activeIndex = Math.min(Number(localStorage.getItem("hatchActiveSectionIndex") || 0), builderSections.length);
    const isFinal = shouldShowFinalReview(brief, activeIndex);
    const files = readLocalJson("skillnestDraftFiles", []);
    if (brief?.isProcessing) {
      return `
        <div class="conversation-focus-card processing">
          <span>Reading</span>
          <h3>I’m reading through your project...</h3>
          <p>I’ll handle the structure and bring back a first version.</p>
        </div>
      `;
    }
    if (isFinal) return finalReviewMarkup(brief, files, completed);
    if (brief.stage === "invalid_input" || brief.isValidProject === false || Number(brief.confidence || 0) < 40) return "";

    const section = builderSections[activeIndex];
    const value = sectionLongValue(brief, section);
    return `
      <div class="conversation-focus-card compact-conversation-focus">
        <div>
          <span>Now working on</span>
          <h3>${escapeHtml(section.label)}</h3>
        </div>
        ${value ? `<p class="quiet-update">Current draft: ${escapeHtml(sectionSummary(brief, section))}</p>` : ""}
      </div>
    `;
  }

  function taskReviewBriefMarkup(brief, files = []) {
    const safeBrief = brief?.ok ? brief : generateTaskBrief("", files);
    const completed = readLocalJson("hatchCompletedSections", []);
    const activeIndex = Math.min(Number(localStorage.getItem("hatchActiveSectionIndex") || 0), builderSections.length);
    const stepNumber = Math.min(activeIndex + 1, builderSections.length);
    const isFinal = shouldShowFinalReview(safeBrief, activeIndex);
    const understood = Array.isArray(safeBrief.whatIUnderstood) ? safeBrief.whatIUnderstood.slice(0, 3) : [];
    const uncertainty = Array.isArray(safeBrief.remainingUncertainties) ? safeBrief.remainingUncertainties[0] : "";

    return `
      <div class="tracker-card">
        <div class="builder-progress">
          <span>${isFinal ? "Final check" : `Step ${stepNumber} of ${builderSections.length}`}</span>
          <strong>${isFinal ? "Ready for an Operator" : escapeHtml(builderSections[activeIndex].label)}</strong>
        </div>
        <div class="step-track">
          ${builderSections.map((section, index) => `<span class="${completed.includes(section.id) ? "done" : ""} ${index === activeIndex ? "active" : ""}"></span>`).join("")}
        </div>
        ${isFinal ? `<p class="tracker-note">The brief is ready for a final look.</p>` : `<p class="tracker-note">Hatch is building the brief quietly as you answer.</p>`}
        ${understood.length ? `
          <div class="understanding-list">
            <span>Hatch understands</span>
            ${understood.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
          </div>
        ` : ""}
        ${uncertainty && !isFinal ? `<p class="tracker-note">Still thinking through: ${escapeHtml(uncertainty)}</p>` : ""}
        ${liveUnderstandingCard(safeBrief, files)}
        ${sectionRail(safeBrief, activeIndex, completed)}
      </div>
    `;
  }

  function clarificationCardMarkup(brief) {
    const question = nextClarification(brief);
    if (!question) {
      return `
        <section class="clarification-card ready">
          <h2>Ready to post.</h2>
          <p>Your project brief has enough detail for Operators to understand the work.</p>
        </section>
      `;
    }
    const showSuggestions = projectReadiness(brief) !== "Needs More Context" || (brief.clarificationCount || 0) > 0;

    return `
      <section class="clarification-card">
        <h2>Here’s what I understand so far.</h2>
        <p>${escapeHtml(understandingStatement(brief))}</p>
        <p>${escapeHtml(question.reason)}</p>
        <strong class="clarification-question">${escapeHtml(question.prompt)}</strong>
        ${showSuggestions ? `<div class="suggestion-row">
          ${question.suggestions.map((item) => `<button class="choice-chip" type="button" onclick="SkillNestApp.sendAssistantReply('${escapeHtml(item)}')">${escapeHtml(item)}</button>`).join("")}
        </div>` : ""}
        <div class="clarification-input">
          <input id="clarificationAnswer" type="text" placeholder="${escapeHtml(question.placeholder)}" />
          <button class="btn primary small" type="button" onclick="SkillNestApp.sendAssistantReply(document.getElementById('clarificationAnswer')?.value || '')">Add</button>
        </div>
      </section>
    `;
  }

  function assistantConversationMarkup(messages = [], brief) {
    const question = nextClarification(brief);
    const shownMessages = messages.length
      ? messages
      : [{ role: "assistant", text: fallbackAssistantMessage(brief) }];
    const aiError = localStorage.getItem("hatchAiLastError") || "";
    const activeIndex = Math.min(Number(localStorage.getItem("hatchActiveSectionIndex") || 0), builderSections.length);
    const ready = briefReadyForReview(brief, activeIndex);
    const processing = Boolean(brief?.isProcessing);
    // "Thinking" covers both the first-run processing brief and any in-flight
    // refine turn (flagged in localStorage), so the animated bubble shows while
    // the assistant is working, in place of a static placeholder message.
    const thinking = processing || localStorage.getItem("hatchAssistantThinking") === "true";
    const invalid = brief?.stage === "invalid_input" || brief?.isValidProject === false || Number(brief?.confidence || 0) < 40;
    const placeholder = invalid ? "Tell Hatch what you want to build or get done..." : "Reply to Hatch...";
    const contextualSuggestions = !thinking && !ready && !invalid && question?.suggestions?.length ? question.suggestions : [];
    const files = readLocalJson("skillnestDraftFiles", []);
    const activeSectionId = builderSections[activeIndex]?.id || "";
    const showFileTools = !thinking && !ready && !invalid && activeSectionId === "references";
    const debugState = window.HatchAIController?.getState?.() || {};
    // AI debugging output is admin-gated (off by default) so a normal visitor
    // never sees intake internals or raw model responses.
    const aiDebugOn = (window.SkillNestApp?.getSiteStats?.() || {}).aiDebug === true;
    // Hide the fallback greeting while thinking with an empty thread, so the
    // very first response shows just the thinking bubble, then types in.
    const threadMessages = messages.length ? messages : (thinking ? [] : shownMessages);

    return `
      <section class="assistant-panel">
        ${aiDebugOn && aiError ? `<div class="assistant-dev-warning">${escapeHtml(aiError)}</div>` : ""}
        ${aiDebugOn ? aiDebugPanelMarkup(debugState) : ""}
        <div class="assistant-thread" id="assistantThread">
          ${threadMessages.map((message, index) => `
            <article class="assistant-message ${message.role}" data-msg-index="${index}">
              <span>${message.role === "assistant" ? escapeHtml(ASSISTANT_LABEL) : "You"}</span>
              <p>${escapeHtml(message.text)}</p>
            </article>
          `).join("")}
          ${thinking ? `
            <article class="thinking-bubble assistant" aria-live="polite">
              <span>${escapeHtml(ASSISTANT_LABEL)}</span>
              <div class="thinking-dots" role="status" aria-label="${escapeHtml(ASSISTANT_LABEL)} is thinking">
                <span></span><span></span><span></span>
              </div>
            </article>
          ` : ""}
        </div>
        ${showFileTools ? referenceAttachmentMarkup(files, contextualSuggestions) : ""}
        ${!thinking && !showFileTools ? composeFileChipsMarkup(files) : ""}
        ${contextualSuggestions.length && !showFileTools ? `<div class="assistant-suggestions" aria-label="Suggested replies">
          <small>Reply naturally, or choose one below.</small>
          ${contextualSuggestions.map((item) => `<button class="choice-chip" type="button" onclick="SkillNestApp.sendAssistantReply(decodeURIComponent('${encodeURIComponent(item)}'))">${escapeHtml(item)}</button>`).join("")}
        </div>` : ""}
        ${thinking ? "" : `
          <div class="assistant-compose">
            ${attachMenuMarkup()}
            <input id="assistantReply" type="text" placeholder="${escapeHtml(placeholder)}" onkeydown="SkillNestApp.handleAssistantReplyKey(event)" />
            <button class="btn primary small" type="button" onclick="SkillNestApp.sendAssistantReply()">Send</button>
          </div>
          <input id="composeAttachFile" class="hidden-file" type="file" multiple onchange="SkillNestApp.handleTaskFiles(event)" />
          <div class="review-post-panel">
            ${ready ? `<p class="review-ready-note">${escapeHtml(ASSISTANT_LABEL)} thinks this Hatch is ready. Look it over, then post it for Operators.</p>` : ""}
            <button class="btn primary full review-post-cta" type="button" ${ready ? "" : "disabled"} onclick="SkillNestApp.openHatchReview()">Review and Post</button>
          </div>
          <p class="assistant-input-hint">Type freely — Hatch will organize it.</p>
          <p class="inline-error" id="assistantInputError">Type a message before sending.</p>
        `}
      </section>
    `;
  }

  // Small "+" trigger next to the reply box. Opens upward (native <details>,
  // no JS needed to toggle) with generic upload categories so an Operator can
  // attach a file at any point in the conversation, not only when Hatch is
  // specifically asking for reference material.
  function attachMenuMarkup() {
    const options = [
      ["Reference image or photo", "Reference image"],
      ["Logo or brand assets", "Logo/brand assets"],
      ["Document (PDF, Word, etc.)", "Document"],
      ["Other file", "Other material"],
    ];
    return `
      <details class="attach-menu">
        <summary class="attach-menu-trigger" aria-label="Attach a file" title="Attach a file">+</summary>
        <div class="attach-menu-panel" role="menu">
          <p class="attach-menu-title">Add a file</p>
          ${options.map(([label, materialType]) => `
            <button type="button" role="menuitem" onclick="this.closest('details').removeAttribute('open'); SkillNestApp.attachComposeFile('${escapeHtml(materialType)}')">${escapeHtml(label)}</button>
          `).join("")}
        </div>
      </details>
    `;
  }

  // Compact chip row so files attached via the "+" menu are visible without
  // pulling in the heavier reference-attachment panel (which already shows
  // its own file list when the references step is active).
  function composeFileChipsMarkup(files = []) {
    if (!files.length) return "";
    return `
      <div class="compose-file-chips" aria-label="Attached files">
        ${files.map((file, index) => `
          <span class="compose-file-chip">
            ${escapeHtml(file.name || file)}
            <button type="button" aria-label="Remove ${escapeHtml(file.name || "file")}" onclick="SkillNestApp.removeDraftFile(${index})">&times;</button>
          </span>
        `).join("")}
      </div>
    `;
  }

  function aiDebugPanelMarkup(state = {}) {
    const fallbackUsed = state.fallbackUsed === true || state.lastAssistantSource === "local-fallback";
    const provider = fallbackUsed ? "Local fallback" : (state.lastProvider || "DeepSeek");
    const model = state.lastModel || "deepseek-v4-flash";
    const raw = state.lastRawResponse || "";
    return `
      <details class="ai-debug-panel" ${fallbackUsed ? "open" : ""}>
        <summary>AI debug · ${escapeHtml(provider)}${state.lastResponseTimeMs ? ` · ${escapeHtml(String(state.lastResponseTimeMs))}ms` : ""}</summary>
        ${fallbackUsed ? `<div class="ai-debug-warning">Local fallback is being used. DeepSeek did not generate this response.</div>` : ""}
        <div class="ai-debug-grid">
          <span>Provider</span><strong>${escapeHtml(provider)}</strong>
          <span>Model</span><strong>${escapeHtml(model)}</strong>
          <span>Last response time</span><strong>${state.lastResponseTimeMs ? `${escapeHtml(String(state.lastResponseTimeMs))}ms` : "Not recorded"}</strong>
          <span>Fallback used</span><strong>${fallbackUsed ? "true" : "false"}</strong>
          <span>Last intent</span><strong>${escapeHtml(state.lastIntent || "Not recorded")}</strong>
          <span>Active section</span><strong>${escapeHtml(state.activeSection || "Not recorded")}</strong>
          <span>Active question</span><strong>${escapeHtml(state.activeQuestion || "Not recorded")}</strong>
          <span>Last user message</span><strong>${escapeHtml(state.lastUserMessage || "Not recorded")}</strong>
          <span>Fields updated</span><strong>${escapeHtml((state.lastFieldsUpdated || []).join(", ") || "None")}</strong>
          <span>Missing info before</span><strong>${escapeHtml((state.missingInfoBefore || []).join(", ") || "None")}</strong>
          <span>Missing info after</span><strong>${escapeHtml((state.missingInfoAfter || []).join(", ") || "None")}</strong>
          <span>Next question</span><strong>${escapeHtml(state.lastNextQuestion || "Not recorded")}</strong>
          <span>Duplicate blocked</span><strong>${state.duplicateBlocked ? "true" : "false"}</strong>
          <span>Last assistant source</span><strong>${escapeHtml(state.lastAssistantSource || (fallbackUsed ? "local-fallback" : "deepseek"))}</strong>
        </div>
        <details class="ai-raw-response">
          <summary>Raw DeepSeek response</summary>
          <pre>${escapeHtml(raw || "No raw DeepSeek response recorded yet.")}</pre>
        </details>
      </details>
    `;
  }

  return {
    readLocalJson,
    briefReadyForReview,
    finalReviewMarkup,
    clarificationCardMarkup,
    assistantConversationMarkup,
    taskReviewBriefMarkup,
  };
})());
