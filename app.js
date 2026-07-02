window.SkillNestApp = (() => {
  const { tasks, operators } = window.SkillNestData;
  const C = window.SkillNestComponents;
  const Pages = window.SkillNestPages;
  let voiceRecognition = null;
  let isVoiceListening = false;
  let isVoicePaused = false;
  let voiceHadTranscript = false;
  let voiceSessionText = "";

  function currentRoute() {
    return window.location.hash.replace("#", "") || "home";
  }

  function setRoute(route) {
    window.location.hash = route;
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  function getAccount() {
    const account = readJson("skillnestAccount", {});
    if (account.role === "AI Builder") return { ...account, role: "Hatcher" };
    if (account.role === "Client and AI Builder") return { ...account, role: "Client and Hatcher" };
    return account;
  }

  function getMissions() {
    return readJson("skillnestMissions", []);
  }

  function getPostedTasks() {
    return readJson("skillnestPostedTasks", []);
  }

  function marketplaceTasks() {
    const posted = getPostedTasks().map((task) => {
      const industry = task.industry || task.category || "General";
      const category = task.category || industry;
      const rawObjective = task.objective || task.description || task.summary || "";
      const genericObjective = /ready for a hatcher to review|clear hatch brief/i.test(rawObjective);
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
        files: Array.isArray(task.files) ? task.files : [],
        references: Array.isArray(task.references) ? task.references : [],
      };
    });
    const postedIds = new Set(posted.map((task) => task.id));
    return [...posted, ...tasks.filter((task) => !postedIds.has(task.id))];
  }

  function getOperatorApplications() {
    return readJson("skillnestOperatorApplications", []);
  }

  function isLoggedIn() {
    const account = getAccount();
    return localStorage.getItem("skillnestLoggedIn") === "true" && Boolean(account.username && account.name && account.email);
  }

  function saveListItem(key, item, matchKey = "title") {
    const list = readJson(key, []);
    const index = list.findIndex((existing) => existing[matchKey] === item[matchKey]);
    if (index >= 0) list[index] = { ...list[index], ...item };
    else list.unshift(item);
    localStorage.setItem(key, JSON.stringify(list));
  }

  function saveDraftTask() {
    const prompt = document.getElementById("taskPrompt");
    if (prompt) localStorage.setItem("skillnestDraftTask", prompt.value.trim());
  }

  function getGeneratedBrief() {
    return readJson("skillnestGeneratedBrief", null);
  }

  function getAssistantMessages() {
    return readJson("hatchAssistantMessages", []);
  }

  function saveAssistantMessages(messages) {
    localStorage.setItem("hatchAssistantMessages", JSON.stringify(messages));
  }

  function sectionIdFromUpdateKey(key) {
    return {
      project: "title",
      business: "businessType",
      goal: "summary",
      timeline: "suggestedTimeline",
      budget: "suggestedBudget",
    }[key] || key;
  }

  function firstRunMessage(brief) {
    if (!brief?.isValidProject || brief.stage === "invalid_input") {
      return brief.assistantMessage || "Tell me what you need done, who it is for, and what a good result would look like.";
    }
    const title = brief.title || "this Hatch";
    const summary = brief.summary || `Shape ${title.toLowerCase()} into a clear Hatch.`;
    return `I think I’ve got the main idea: ${summary}\n\nI’ll handle the structure. ${nextSpecificQuestion(brief)}`;
  }

  function inferredCompletedSections(brief) {
    const completed = [];
    if (brief.title) completed.push("title");
    if (brief.businessType && brief.businessType !== "To be confirmed") completed.push("businessType");
    if (brief.summary) completed.push("summary");
    if (brief.deliverables?.length) completed.push("deliverables");
    if (brief.timelineKnown) completed.push("suggestedTimeline");
    if (brief.budgetKnown) completed.push("suggestedBudget");
    if (brief.industry && brief.industry !== "General business") completed.push("industry");
    if (brief.references?.length) completed.push("references");
    if (brief.constraints?.length) completed.push("constraints");
    return completed;
  }

  function initializeBuilderProgress(brief) {
    const ids = briefSectionIds();
    const completed = inferredCompletedSections(brief);
    const firstOpen = ids.findIndex((id) => !completed.includes(id));
    localStorage.setItem("hatchCompletedSections", JSON.stringify(completed));
    localStorage.setItem("hatchActiveSectionIndex", String(firstOpen === -1 ? ids.length : firstOpen));
  }

  function mergeInferredProgress(brief) {
    if (!brief?.ok || !brief.isValidProject) return;
    const ids = briefSectionIds();
    const completed = new Set([...completedSections(), ...inferredCompletedSections(brief)]);
    const firstOpen = ids.findIndex((id) => !completed.has(id));
    const currentIndex = Number(localStorage.getItem("hatchActiveSectionIndex") || 0);
    const currentId = ids[currentIndex];
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
    if (!currentId || completed.has(currentId) || brief.stage === "invalid_input") {
      setActiveSectionIndex(firstOpen === -1 ? ids.length : firstOpen);
    }
  }

  function nextSpecificQuestion(brief) {
    const missing = new Set(brief?.missingInfo || []);
    if (!brief?.timelineKnown && (missing.has("timeline") || brief?.suggestedTimeline)) {
      return "The next useful thing is timing. When would you like this finished: this week, this month, or flexible?";
    }
    if (!brief?.budgetKnown && (missing.has("budget") || brief?.suggestedBudget)) {
      return "Now I need a rough budget. Would you prefer under $100, $100-300, $300-700, or flexible?";
    }
    if (!brief?.deliverables?.length) {
      return "For the output, do you want captions, visuals, a content calendar, or all of those?";
    }
    if (!brief?.industry || brief.industry === "General business") {
      return "What kind of business is this for? For example: cafe, salon, online store, or local service.";
    }
    return "Tell me the next detail you know, even if it is rough.";
  }

  function recoveredBriefFromAnswer(answer, previous = {}) {
    const generated = C.generateTaskBrief(answer, previous.files || []);
    if (!generated.ok) return null;
    const nextBrief = {
      ...previous,
      ...generated,
      ok: true,
      stage: "clarifying_missing_info",
      isValidProject: true,
      confidence: Math.max(Number(generated.confidence || 0), 58),
      sourceText: [previous.sourceText, answer].filter(Boolean).join("\n"),
      clarificationCount: Math.min((previous.clarificationCount || 0) + 1, 5),
    };
    if (nextBrief.category === "Content" && nextBrief.industry === "Restaurant") {
      nextBrief.title = "Instagram content for a cafe";
      nextBrief.summary = "Create Instagram content for a cafe so the business can post more consistently.";
      nextBrief.deliverables = ["Instagram post ideas", "Captions or copy", "Simple handoff notes"];
    }
    nextBrief.assistantMessage = `I can work with that. I’ve set this up as ${nextBrief.title.toLowerCase()}. ${nextSpecificQuestion(nextBrief)}`;
    nextBrief.nextQuestion = {
      key: !nextBrief.timelineKnown ? "timeline" : !nextBrief.budgetKnown ? "budget" : "deliverables",
      prompt: nextSpecificQuestion(nextBrief),
      suggestions: !nextBrief.timelineKnown ? ["This week", "This month", "Flexible"] : !nextBrief.budgetKnown ? ["Under $100", "$100-300", "$300-700", "Flexible"] : [],
      placeholder: "Type your answer",
    };
    return nextBrief;
  }

  function invalidGuidance(answer = "", key = "") {
    const clean = answer.toLowerCase().replace(/\binstragram\b/g, "instagram").replace(/\binsta\b/g, "instagram");
    if (key === "timeline") return "I’ll keep us on timing for a moment. You can say this week, next month, a date, or flexible.";
    if (key === "budget") return "I’ll keep us on budget for a moment. A rough range is enough, like under $100, $100-300, or flexible.";
    if (clean.includes("instagram") || clean.includes("insta")) {
      return "I understand Instagram is involved. Do you need content creation, account management, ads, or growth strategy?";
    }
    if (clean.includes("website")) {
      return "I understand this is about a website. Is it a new site, a redesign, or a small update?";
    }
    return "I’m not fully sure what you want done yet. Try one sentence like: create Instagram posts for my cafe, build a website for my salon, or organize customer data.";
  }

  function invalidProjectBrief(sourceText = "") {
    return {
      ok: true,
      stage: "invalid_input",
      isValidProject: false,
      confidence: 10,
      title: "",
      businessType: "",
      industry: "",
      category: "General",
      suggestedLevel: "L1",
      suggestedBudget: "",
      suggestedTimeline: "",
      budgetKnown: false,
      timelineKnown: false,
      deliverables: [],
      knownRequirements: [],
      constraints: [],
      references: [],
      missingInfo: ["project request"],
      recommendedHatcherType: "",
      summary: "",
      assistantMessage: "I’m not fully sure what you want done yet. Try one sentence like: create Instagram posts for my cafe, build a website for my salon, or organize customer data.",
      nextQuestion: {
        key: "objective",
        prompt: "What are you trying to accomplish?",
        suggestions: ["Create social posts", "Build a simple website", "Organize customer data"],
        placeholder: "Describe the project in your own words",
      },
      readiness: "Needs More Context",
      sourceText,
      clarificationCount: 0,
    };
  }

  function processingProjectBrief(sourceText = "", files = []) {
    return {
      ok: true,
      stage: "understanding_project",
      isValidProject: true,
      confidence: 0,
      title: "",
      businessType: "",
      industry: "",
      category: "General",
      suggestedLevel: "L1",
      suggestedBudget: "",
      suggestedTimeline: "",
      budgetKnown: false,
      timelineKnown: false,
      deliverables: [],
      knownRequirements: [],
      constraints: [],
      references: [],
      missingInfo: ["Project", "Goal", "Business", "Deliverables"],
      recommendedHatcherType: "",
      summary: "",
      assistantMessage: "I’m reading through your project...",
      nextQuestion: { key: "none", prompt: "", suggestions: [], placeholder: "" },
      readiness: "Understanding Your Project",
      sourceText,
      files,
      isProcessing: true,
      clarificationCount: 0,
    };
  }

  function accountRoute(account = getAccount()) {
    if (account.role === "Operator" || account.role === "AI Builder" || account.role === "Hatcher") return "operator";
    if (account.role === "Client and operator" || account.role === "Client and AI Builder" || account.role === "Client and Hatcher") return "profile";
    return "post-task";
  }

  function setTaskError(message) {
    const error = document.getElementById("taskPromptError");
    if (!error) return;
    error.textContent = message;
    error.classList.add("show");
  }

  function clearTaskError() {
    document.getElementById("taskPromptError")?.classList.remove("show");
  }

  function startTaskFlow() {
    saveDraftTask();
    localStorage.removeItem("skillnestGeneratedBrief");
    localStorage.removeItem("hatchAssistantMessages");
    localStorage.removeItem("hatchActiveSectionIndex");
    localStorage.removeItem("hatchCompletedSections");
    localStorage.removeItem("hatchSectionMessages");
    localStorage.removeItem("hatchBriefEditKey");
    const prompt = document.getElementById("taskPrompt");
    const files = readJson("skillnestDraftFiles", []);
    const reviewButton = document.getElementById("reviewTaskButton");
    if (!prompt?.value.trim()) {
      setTaskError("Describe the Hatch first, even with one short sentence.");
      prompt?.focus();
      return;
    }

    clearTaskError();
    if (reviewButton) {
      reviewButton.textContent = "Understanding your project...";
      reviewButton.disabled = true;
    }

    const processingBrief = processingProjectBrief(prompt.value, files);
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(processingBrief));
    saveAssistantMessages([{ role: "assistant", text: "I’m reading through your project..." }]);
    setRoute("task-review");

    window.setTimeout(async () => {
      const brief = await requestProjectIntake({
        mode: "organize",
        inputText: prompt.value,
        files,
      });
      if (!brief.ok) {
        localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(invalidProjectBrief(prompt.value)));
        saveAssistantMessages([{ role: "assistant", text: "Tell me what you need done, who it is for, and what a good result would look like." }]);
        render();
        return;
      }

      initializeBuilderProgress(brief);
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(brief));
      saveAssistantMessages([{ role: "assistant", text: firstRunMessage(brief) }]);
      render();
    }, 420);
  }

  async function requestProjectIntake(payload) {
    if (payload.mode !== "clarify" && C.isLowQualityProjectInput(payload.inputText || "", payload.files || [])) {
      localStorage.setItem("hatchAiIntakeMode", "local-validation");
      return invalidProjectBrief(payload.inputText || "");
    }

    try {
      const response = await fetch("/api/project-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("AI intake unavailable");
      const data = await response.json();
      if (!data.ok || !data.brief) throw new Error(data.error || "AI intake unavailable");
      localStorage.setItem("hatchAiIntakeMode", "connected");
      return normalizeProjectBrief(data.brief, payload);
    } catch {
      localStorage.setItem("hatchAiIntakeMode", "local-fallback");
      if (payload.mode === "clarify") return fallbackClarification(payload.brief, payload.key, payload.answer);
      if (C.isLowQualityProjectInput(payload.inputText || "", payload.files || [])) return invalidProjectBrief(payload.inputText || "");
      return C.generateTaskBrief(payload.inputText || "", payload.files || []);
    }
  }

  async function requestProjectAssistant(payload) {
    try {
      const response = await fetch("/api/project-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("AI assistant unavailable");
      const data = await response.json();
      if (!data.ok || !data.result) throw new Error(data.error || "AI assistant unavailable");
      localStorage.setItem("hatchAiIntakeMode", "connected");
      return data.result;
    } catch {
      localStorage.setItem("hatchAiIntakeMode", "local-fallback");
      const nextBrief = fallbackClarification(payload.brief, payload.key, payload.answer);
      return {
        ok: true,
        assistantMessage: nextBrief.assistantMessage || C.fallbackAssistantMessage(nextBrief),
        brief: nextBrief,
      };
    }
  }

  function normalizeProjectBrief(brief, payload = {}) {
    const structuredBrief = brief.brief && typeof brief.brief === "object";
    const serverShaped = structuredBrief || brief.is_valid_project !== undefined || brief.assistant_message !== undefined || brief.missing_fields !== undefined;
    if (serverShaped) {
      return normalizeIntakeResponse(brief, payload);
    }

    const fallback = payload.mode === "clarify"
      ? { ...(payload.brief || {}) }
      : C.generateTaskBrief(payload.inputText || brief.sourceText || "", payload.files || brief.files || []);

    return {
      ...fallback,
      ...brief,
      ok: brief.ok !== false,
      title: brief.title || fallback.title || "New project",
      deliverables: Array.isArray(brief.deliverables) ? brief.deliverables : fallback.deliverables || [],
      knownRequirements: Array.isArray(brief.knownRequirements) ? brief.knownRequirements : fallback.knownRequirements || [],
      constraints: Array.isArray(brief.constraints) ? brief.constraints : fallback.constraints || [],
      references: Array.isArray(brief.references) ? brief.references : fallback.references || [],
      missingInfo: Array.isArray(brief.missingInfo) ? brief.missingInfo : fallback.missingInfo || [],
      sourceText: brief.sourceText || fallback.sourceText || payload.inputText || "",
      files: Array.isArray(brief.files) ? brief.files : payload.files || fallback.files || [],
      clarificationCount: Number.isFinite(Number(brief.clarificationCount))
        ? Number(brief.clarificationCount)
        : fallback.clarificationCount || 0,
    };
  }

  function normalizeIntakeResponse(response, payload = {}) {
    const previous = payload.brief || {};
    const rawBrief = response.brief || {};
    const sectionUpdates = response.section_updates || {};
    const sourceFallback = C.generateTaskBrief(payload.inputText || previous.sourceText || "", payload.files || previous.files || []);
    const isValidProject = response.is_valid_project === true || response.isValidProject === true;
    const confidence = Math.max(0, Math.min(100, Number(response.confidence) || 0));
    const stage = ["invalid_input", "understanding_project", "clarifying_missing_info", "ready_to_post"].includes(response.stage)
      ? response.stage
      : (isValidProject && confidence >= 40 ? "clarifying_missing_info" : "invalid_input");

    if (!isValidProject || confidence < 40 || stage === "invalid_input") {
      if (payload.mode === "clarify" && payload.answer) {
        const recovered = recoveredBriefFromAnswer(payload.answer, previous);
        if (recovered) return recovered;
      }
      if (payload.mode === "clarify" && previous?.isValidProject) {
        const contextual = contextualClarificationFallback(previous, payload.key, payload.answer || "");
        if (contextual) return contextual;
        return {
          ...previous,
          assistantMessage: payload.key === "timeline"
            ? "I’ll keep us on timeline for a moment. You can say something like this week, next month, or flexible."
            : payload.key === "budget"
              ? "I’ll keep us on budget for a moment. You can give a range, or say flexible."
              : invalidGuidance(payload.answer || "", payload.key || ""),
        };
      }
      return {
        ...invalidProjectBrief(payload.inputText || previous.sourceText || ""),
        confidence,
        clarificationCount: previous.clarificationCount || 0,
      };
    }

    if (payload.mode === "clarify" && payload.key && payload.answer) {
      const validation = validateSectionAnswer(payload.key, payload.answer, previous);
      if (!validation.ok) {
        return {
          ...previous,
          assistantMessage: validation.message,
          nextQuestion: validation.question,
          clarificationCount: Math.min(Number(previous.clarificationCount || 0) + 1, 5),
        };
      }
    }

    if (payload.mode === "clarify" && response.normalized_value && response.section_id && response.should_mark_complete !== false) {
      const responseSectionId = sectionIdFromUpdateKey(response.section_id);
      const responseKey = assistantKeyForSection(responseSectionId);
      const normalized = normalizeUserAnswer(responseKey, response.normalized_value, previous);
      const nextBrief = updateBriefObject({ ...previous, updatedAt: new Date().toISOString() }, normalized.key, normalized.value);
      nextBrief.assistantMessage = response.assistant_message || response.assistantMessage || normalizedAnswerMessage(responseSectionId, normalized.value);
      nextBrief.completedSectionId = responseSectionId;
      nextBrief.stage = response.ready_to_submit ? "ready_to_post" : "clarifying_missing_info";
      nextBrief.readiness = response.ready_to_submit ? "Ready to Post" : "Almost Ready";
      return nextBrief;
    }

    const missingFields = Array.isArray(response.missing_fields) ? response.missing_fields.filter(Boolean) : [];
    const deliverables = Array.isArray(rawBrief.deliverables) ? rawBrief.deliverables.filter(Boolean) : [];
    const constraints = Array.isArray(rawBrief.constraints) ? rawBrief.constraints.filter(Boolean) : [];
    const references = Array.isArray(rawBrief.references)
      ? rawBrief.references.filter(Boolean)
      : [rawBrief.references].filter(Boolean);
      const nextQuestionText = response.next_question || "";
    const quickReplies = Array.isArray(response.quick_replies) ? response.quick_replies.filter(Boolean) : [];
    const normalizedStage = stage === "ready_to_post" ? "ready_to_post" : (missingFields.length ? "clarifying_missing_info" : "understanding_project");
    const readiness = normalizedStage === "ready_to_post"
      ? "Ready to Post"
      : normalizedStage === "clarifying_missing_info"
        ? "Almost Ready"
        : "Understanding Your Project";

    const normalized = {
      ...previous,
      ok: true,
      stage: normalizedStage,
      isValidProject: true,
      confidence,
      title: sectionUpdates.project || rawBrief.project_title || sourceFallback.title || previous.title || "Untitled Hatch",
      businessType: sectionUpdates.business || rawBrief.business_type || sourceFallback.businessType || previous.businessType || "",
      industry: sectionUpdates.industry || rawBrief.industry || sourceFallback.industry || previous.industry || rawBrief.business_type || "",
      category: rawBrief.category || sourceFallback.category || previous.category || "General",
      suggestedLevel: rawBrief.operator_level || sourceFallback.suggestedLevel || previous.suggestedLevel || "L1",
      suggestedBudget: sectionUpdates.budget || rawBrief.budget || previous.suggestedBudget || "",
      suggestedTimeline: sectionUpdates.timeline || rawBrief.deadline || previous.suggestedTimeline || "",
      budgetKnown: Boolean(sectionUpdates.budget || rawBrief.budget || previous.budgetKnown),
      timelineKnown: Boolean(sectionUpdates.timeline || rawBrief.deadline || previous.timelineKnown),
      deliverables: Array.isArray(sectionUpdates.deliverables) && sectionUpdates.deliverables.length ? sectionUpdates.deliverables : deliverables.length ? deliverables : sourceFallback.deliverables || previous.deliverables || [],
      knownRequirements: previous.knownRequirements || [],
      constraints: Array.isArray(sectionUpdates.constraints) && sectionUpdates.constraints.length ? sectionUpdates.constraints : constraints.length ? constraints : previous.constraints || [],
      references: sectionUpdates.references ? [sectionUpdates.references].flat().filter(Boolean) : references.length ? references : previous.references || [],
      missingInfo: missingFields,
      recommendedHatcherType: rawBrief.operator_level ? `${rawBrief.operator_level} Hatcher` : previous.recommendedHatcherType || "",
      summary: sectionUpdates.goal || rawBrief.goal || sourceFallback.summary || previous.summary || "",
      assistantMessage: response.assistant_message || response.assistantMessage || C.fallbackAssistantMessage(previous),
      nextQuestion: nextQuestionText ? {
        key: missingFields[0] || "general",
        prompt: nextQuestionText,
        suggestions: quickReplies,
        placeholder: "Type your answer",
      } : { key: "none", prompt: "", suggestions: [], placeholder: "" },
      readiness,
      sourceText: payload.inputText || rawBrief.sourceText || previous.sourceText || "",
      files: Array.isArray(rawBrief.files) ? rawBrief.files : payload.files || previous.files || [],
      clarificationCount: Math.min(Number(previous.clarificationCount || 0) + (payload.mode === "clarify" ? 1 : 0), 5),
    };

    if (sourceFallback.ok && sourceFallback.title?.toLowerCase().includes("instagram")) {
      normalized.title = sourceFallback.title;
      normalized.summary = sourceFallback.summary || normalized.summary;
      normalized.deliverables = sourceFallback.deliverables?.length ? sourceFallback.deliverables : normalized.deliverables;
      normalized.category = sourceFallback.category || normalized.category;
      normalized.businessType = sourceFallback.businessType || normalized.businessType;
      normalized.industry = sourceFallback.industry || normalized.industry;
      normalized.nextQuestion = normalized.nextQuestion?.key && normalized.nextQuestion.key !== "none" ? normalized.nextQuestion : sourceFallback.nextQuestion;
    }

    if (payload.mode === "clarify" && payload.sectionId && !questionLike(payload.answer || "") && response.next_action !== "answer_question") {
      normalized.completedSectionId = payload.sectionId;
    }

    if (Array.isArray(response.completed_sections) && response.completed_sections.length) {
      const completed = response.completed_sections.map(sectionIdFromUpdateKey);
      localStorage.setItem("hatchCompletedSections", JSON.stringify([...new Set([...completedSections(), ...completed])]));
    }

    if (response.active_section) {
      const ids = briefSectionIds();
      const sectionId = sectionIdFromUpdateKey(response.active_section);
      const index = ids.indexOf(sectionId);
      if (index >= 0) setActiveSectionIndex(index);
    }

    return normalized;
  }

  function removeMissingInfo(brief, key) {
    return (brief.missingInfo || []).filter((item) => item !== key);
  }

  function briefKeyFromAssistantKey(key) {
    return {
      timeline: "suggestedTimeline",
      budget: "suggestedBudget",
      objective: "summary",
    }[key] || key;
  }

  function uncertainAnswer(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return [
      "i dont know",
      "i don t know",
      "i am not sure",
      "im not sure",
      "not sure",
      "no idea",
      "unsure",
      "idk",
      "up to you",
      "you decide",
    ].includes(clean);
  }

  function correctionIntent(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return clean.startsWith("no actually") || clean.startsWith("actually") || clean.startsWith("no wait") || clean.includes("i meant");
  }

  function recentTopicFromMessages(messages = []) {
    const assistantMessages = messages.filter((message) => message.role === "assistant").slice().reverse();
    for (const message of assistantMessages) {
      const text = String(message.text || "").toLowerCase();
      if (text.includes("timeline") || text.includes("timing") || text.includes("finished") || text.includes("this week") || text.includes("this month")) return "timeline";
      if (text.includes("budget") || text.includes("range") || text.includes("$")) return "budget";
      if (text.includes("deliverable") || text.includes("captions") || text.includes("visuals")) return "deliverables";
    }
    return "";
  }

  function sectionIdForAssistantKey(key = "") {
    return {
      timeline: "suggestedTimeline",
      budget: "suggestedBudget",
      deliverables: "deliverables",
    }[key] || key;
  }

  function questionLike(answer = "") {
    const clean = answer.toLowerCase().trim();
    return clean.endsWith("?") || /^(what|why|how|can|could|should|would|do|does|is|are|will)\b/.test(clean);
  }

  function adviceRequest(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return questionLike(answer)
      || clean.includes("makes sense")
      || clean.includes("what time")
      || clean.includes("what budget")
      || clean.includes("you recommend")
      || clean.includes("recommend")
      || clean.includes("suggest")
      || clean.includes("what should")
      || clean.includes("which one");
  }

  function adviceForSection(brief, key) {
    const category = brief?.category || "General";
    const level = brief?.suggestedLevel || "L1";
    if (key === "timeline") {
      const message = category === "Content"
        ? "For content work, this week makes sense if it’s just captions or a small batch. If you want a full calendar with visuals, this month is safer."
        : level === "L3" || level === "L4"
          ? "For this level of work, I’d usually give it one to two weeks so the Hatcher has room to test and refine it."
          : "For a simple Hatch, this week is reasonable. If you’re not in a rush, flexible gives Hatchers more room to do it well.";
      return {
        message: `${message} Which should I put down?`,
        question: {
          key: "timeline",
          prompt: "Which timeline should I use?",
          suggestions: ["This week", "This month", "Flexible"],
          placeholder: "Type a timeline",
        },
      };
    }
    if (key === "budget") {
      const message = level === "L1"
        ? "For an L1 Hatch, I’d start around $50-150. If you want more polish or several versions, $150-300 gives more room."
        : level === "L2"
          ? "For this kind of Hatch, $150-500 is a realistic range depending on how much detail you want."
          : "For a more technical Hatch, I’d expect at least $500 so the Hatcher can build and test it properly.";
      return {
        message: `${message} Which range should I use for now?`,
        question: {
          key: "budget",
          prompt: "Which budget range should I use?",
          suggestions: ["Under $100", "$100-300", "$300-700", "Flexible"],
          placeholder: "Type a budget",
        },
      };
    }
    if (key === "deliverables") {
      return {
        message: "For this Hatch, I’d include a first usable draft plus editable handoff notes. If it’s Instagram content, captions and a simple posting plan would be the clearest deliverables.",
        question: {
          key: "deliverables",
          prompt: "Should I include captions, visuals, a posting plan, or all three?",
          suggestions: ["Captions", "Visuals", "Posting plan", "All three"],
          placeholder: "Type deliverables",
        },
      };
    }
    return {
      message: "I can help decide. Tell me what part you’re unsure about, and I’ll suggest a practical option.",
      question: {
        key,
        prompt: "What part should I help you decide?",
        suggestions: [],
        placeholder: "Type your question",
      },
    };
  }

  function uncertaintyForSection(brief, key) {
    const advice = adviceForSection(brief, key);
    return {
      ...advice,
      message: `No worries — I can recommend one. ${advice.message}`,
    };
  }

  function normalizedAnswer(answer = "") {
    return String(answer || "").toLowerCase().replace(/[^\w\s$-]/g, " ").replace(/\s+/g, " ").trim();
  }

  function looksLikeNoise(answer = "") {
    const clean = normalizedAnswer(answer);
    if (!clean) return true;
    const words = clean.split(" ").filter(Boolean);
    const unique = new Set(words);
    if (clean.length < 3) return true;
    if (words.length >= 2 && unique.size === 1) return true;
    if (/^(.)\1{4,}$/.test(clean.replace(/\s/g, ""))) return true;
    if (!/[aeiou]/.test(clean) && clean.length > 6) return true;
    return /^[a-z]{5,}$/.test(clean) && unique.size === 1 && ![
      "cafe", "salon", "store", "shopify", "restaurant", "captions", "website", "flexible",
    ].includes(clean);
  }

  function validTimelineAnswer(answer = "") {
    const clean = normalizedAnswer(answer);
    if (!clean || looksLikeNoise(answer)) return false;
    if (["today", "tomorrow", "asap", "urgent", "flexible", "this week", "next week", "this month", "next month", "no rush"].includes(clean)) return true;
    if (/\b\d+\s*(day|days|week|weeks|month|months)\b/.test(clean)) return true;
    if (/\b(by|before|around|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|next month)\b/.test(clean)) return true;
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/.test(clean)) return true;
    if (/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(clean)) return true;
    return false;
  }

  function validBudgetAnswer(answer = "") {
    const clean = normalizedAnswer(answer);
    if (!clean) return false;
    if (/\d/.test(clean)) return true;
    if (looksLikeNoise(answer)) return false;
    if (["flexible", "not sure", "no idea", "open", "low budget"].includes(clean)) return true;
    return false;
  }

  function validTextAnswer(answer = "", minimum = 3) {
    const clean = normalizedAnswer(answer);
    if (!clean || clean.length < minimum || looksLikeNoise(answer)) return false;
    return true;
  }

  function validationQuestion(key) {
    if (key === "timeline") {
      return {
        key: "timeline",
        prompt: "Which timeline should I use?",
        suggestions: ["This week", "This month", "Flexible"],
        placeholder: "Type a date, range, or flexible",
      };
    }
    if (key === "budget") {
      return {
        key: "budget",
        prompt: "Which budget range should I use?",
        suggestions: ["Under $100", "$100-300", "$300-700", "Flexible"],
        placeholder: "Type a budget range",
      };
    }
    if (key === "deliverables") {
      return {
        key: "deliverables",
        prompt: "What should the Hatcher deliver?",
        suggestions: ["Captions", "Visuals", "Posting plan", "All three"],
        placeholder: "Type the expected output",
      };
    }
    if (key === "industry" || key === "businessType") {
      return {
        key,
        prompt: "What kind of business or industry is this for?",
        suggestions: ["Restaurant", "E-commerce", "Local services", "Education"],
        placeholder: "Type the business or industry",
      };
    }
    return {
      key,
      prompt: "Could you say that in a clearer way?",
      suggestions: [],
      placeholder: "Type a clearer answer",
    };
  }

  function briefSearchText(brief = {}) {
    return [
      brief.title,
      brief.summary,
      brief.businessType,
      brief.industry,
      brief.category,
      ...(brief.deliverables || []),
      brief.sourceText,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function referenceQuestionForBrief(brief = {}) {
    const text = briefSearchText(brief);
    if (text.includes("menu") || text.includes("restaurant") || text.includes("cafe") || text.includes("instagram")) {
      return {
        key: "references",
        prompt: "To make this accurate, the Hatcher needs the menu or food details. Can you provide a menu photo/link, item list with prices, or examples of your current style?",
        suggestions: ["I can attach a menu", "I can paste food items", "No menu yet", "Use best judgment"],
        placeholder: "Paste menu items, prices, links, or notes",
      };
    }
    if (text.includes("website") || text.includes("salon") || text.includes("booking")) {
      return {
        key: "references",
        prompt: "For this website Hatch, the Hatcher needs the services, prices, photos, and any booking link. What can you provide?",
        suggestions: ["Services and prices", "Photos/logo", "Existing website", "No materials yet"],
        placeholder: "Paste services, prices, links, or notes",
      };
    }
    if (text.includes("product") || text.includes("shopify") || text.includes("e-commerce") || text.includes("ecommerce")) {
      return {
        key: "references",
        prompt: "For product work, the Hatcher needs product names, current descriptions, photos, or a store link. What source material do you have?",
        suggestions: ["Product list", "Store link", "Current descriptions", "No materials yet"],
        placeholder: "Paste product details, links, or notes",
      };
    }
    if (text.includes("faq") || text.includes("chatbot") || text.includes("support") || text.includes("reply")) {
      return {
        key: "references",
        prompt: "For customer replies, the Hatcher needs your FAQ, policies, common questions, or examples of your tone. What can you share?",
        suggestions: ["FAQ/policies", "Common questions", "Tone examples", "No materials yet"],
        placeholder: "Paste FAQ, policies, questions, or notes",
      };
    }
    if (text.includes("sheet") || text.includes("workflow") || text.includes("automation") || text.includes("forms")) {
      return {
        key: "references",
        prompt: "For operations work, the Hatcher needs the current process, sample sheet, form, or steps you repeat. What can you provide?",
        suggestions: ["Current process", "Sample sheet", "Form link", "No materials yet"],
        placeholder: "Paste process notes, sheet/form links, or examples",
      };
    }
    return {
      key: "references",
      prompt: "What source material should the Hatcher use: files, examples, links, notes, or existing content?",
      suggestions: ["I have files", "I have links", "No materials yet"],
      placeholder: "Paste a link, note, or source material",
    };
  }

  function questionForSection(sectionId, brief = {}) {
    const key = assistantKeyForSection(sectionId);
    if (key === "timeline") return validationQuestion("timeline");
    if (key === "budget") return validationQuestion("budget");
    if (key === "deliverables") return validationQuestion("deliverables");
    if (key === "businessType") return validationQuestion("businessType");
    if (key === "industry") return validationQuestion("industry");
    if (key === "references") {
      return referenceQuestionForBrief(brief);
    }
    if (key === "constraints") {
      return {
        key: "constraints",
        prompt: "Anything the Hatcher should avoid or keep in mind?",
        suggestions: ["None for now"],
        placeholder: "Type constraints or say none",
      };
    }
    if (sectionId === "summary") {
      return {
        key: "summary",
        prompt: "What outcome matters most for this Hatch?",
        suggestions: [],
        placeholder: "Type the main goal",
      };
    }
    return {
      key,
      prompt: "What should I put for this part?",
      suggestions: [],
      placeholder: "Type your answer",
    };
  }

  function nextOpenSectionId(afterSectionId, completedSet) {
    const ids = briefSectionIds();
    const currentIndex = ids.indexOf(afterSectionId);
    const start = currentIndex >= 0 ? currentIndex + 1 : 0;
    return ids.find((id, index) => index >= start && !completedSet.has(id)) || "";
  }

  function sectionLabel(sectionId) {
    return {
      title: "project",
      businessType: "business",
      summary: "goal",
      deliverables: "deliverables",
      suggestedTimeline: "timeline",
      suggestedBudget: "budget",
      industry: "industry",
      references: "references",
      constraints: "constraints",
    }[sectionId] || "this part";
  }

  function titleCaseShort(text = "") {
    return String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function normalizeMoney(amount) {
    const numeric = String(amount || "").replace(/[^\d.]/g, "");
    if (!numeric) return "";
    const value = Number(numeric);
    if (!Number.isFinite(value)) return "";
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }

  function cleanSentence(text = "") {
    const cleaned = String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^(i\s+want\s+to|i\s+need\s+to|i\s+need|can\s+you|please)\s+/i, "")
      .replace(/\.$/, "");
    if (!cleaned) return "";
    return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}.`;
  }

  function splitListAnswer(text = "") {
    return String(text || "")
      .split(/\n|,|;|\band\b/i)
      .map((item) => cleanSentence(item).replace(/\.$/, ""))
      .filter((item, index, list) => item && list.indexOf(item) === index);
  }

  function normalizeBudgetAnswer(raw = "") {
    const clean = normalizedAnswer(raw);
    if (uncertainAnswer(raw) || /\b(not sure|no idea|flexible|open|need guidance)\b/.test(clean)) return "Flexible / needs guidance";
    const rangeMatch = clean.match(/(?:\$?\s*)?(\d+(?:,\d{3})?)(?:\s*(?:-|to|and|–)\s*)(?:\$?\s*)?(\d+(?:,\d{3})?)/);
    if (rangeMatch) {
      const low = normalizeMoney(rangeMatch[1]);
      const high = normalizeMoney(rangeMatch[2]);
      if (low && high) return `${low}–${high}`;
    }
    const underMatch = clean.match(/\b(?:under|below|less than|max|maximum)\s*\$?\s*(\d+(?:,\d{3})?)\b/);
    if (underMatch) return `Under ${normalizeMoney(underMatch[1])}`;
    const overMatch = clean.match(/\b(?:over|above|at least|min|minimum)\s*\$?\s*(\d+(?:,\d{3})?)\b/);
    if (overMatch) return `At least ${normalizeMoney(overMatch[1])}`;
    const numberMatch = clean.match(/\$?\s*(\d+(?:,\d{3})?)\b/);
    if (numberMatch) return `around ${normalizeMoney(numberMatch[1])}`;
    return titleCaseShort(raw);
  }

  function normalizeTimelineAnswer(raw = "") {
    const clean = normalizedAnswer(raw);
    if (/\b(asap|urgent|immediately|as soon as possible)\b/.test(clean)) return "As soon as possible";
    if (/\b(no rush|flexible|whenever|not urgent)\b/.test(clean)) return "Flexible";
    if (/\bthis week\b/.test(clean)) return "This week";
    if (/\bnext week\b/.test(clean)) return "Next week";
    if (/\bthis month\b/.test(clean)) return "This month";
    if (/\bnext month\b/.test(clean)) return "Next month";
    const weekday = clean.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (weekday) return `By next ${titleCaseShort(weekday[1])}`;
    const byDate = clean.match(/\b(by|before)\s+(.+)/);
    if (byDate) return `By ${titleCaseShort(byDate[2])}`;
    return titleCaseShort(raw);
  }

  function normalizeReferenceAnswer(raw = "") {
    const clean = normalizedAnswer(raw);
    const urls = String(raw || "").match(/https?:\/\/[^\s]+/g);
    if (urls?.length) return urls.join(", ");
    if (/\b(no|none|nothing)\b/.test(clean)) return "No references provided";
    if (/\b(not yet|no references yet|no menu yet|later)\b/.test(clean)) return "No references yet";
    if (/\b(use best judgment|you decide|up to you)\b/.test(clean)) return "Use best judgment; no source materials provided yet";
    return cleanSentence(raw).replace(/\.$/, "");
  }

  function normalizeUserAnswer(sectionId, userInput, currentBrief = {}) {
    const key = briefKeyFromAssistantKey(sectionId);
    const raw = String(userInput || "").trim();
    let value = raw;

    if (key === "suggestedBudget") value = normalizeBudgetAnswer(raw);
    else if (key === "suggestedTimeline") value = normalizeTimelineAnswer(raw);
    else if (key === "references") value = normalizeReferenceAnswer(raw);
    else if (key === "constraints") {
      const clean = normalizedAnswer(raw);
      value = /\b(no|none|nothing|not sure)\b/.test(clean) ? "None for now" : splitListAnswer(raw);
    } else if (key === "deliverables") {
      value = splitListAnswer(raw);
      if (!value.length && currentBrief.deliverables?.length) value = currentBrief.deliverables;
    } else if (key === "summary") {
      value = cleanSentence(raw || currentBrief.summary || "Create a clear, usable result.");
    } else if (key === "businessType" || key === "industry") {
      value = titleCaseShort(raw);
    } else if (key === "title") {
      value = cleanSentence(raw).replace(/\.$/, "") || currentBrief.title || "New Hatch";
    }

    console.info("[Hatch debug] normalized answer", {
      activeSection: sectionId,
      normalizedKey: key,
      raw,
      normalizedValue: value,
    });

    return { key, value };
  }

  function normalizedAnswerMessage(sectionId, normalizedValue, nextQuestion) {
    const valueText = Array.isArray(normalizedValue) ? normalizedValue.join(", ") : String(normalizedValue || "");
    const nextText = nextQuestion?.prompt
      ? ` Next, ${nextQuestion.prompt.charAt(0).toLowerCase()}${nextQuestion.prompt.slice(1)}`
      : "";
    if (sectionId === "suggestedBudget") return `That works — I’ll write the budget as ${valueText}.${nextText}`;
    if (sectionId === "suggestedTimeline") return `That works — I’ll write the timeline as ${valueText}.${nextText}`;
    if (sectionId === "deliverables") return `That helps. I cleaned up the deliverables.${nextText}`;
    if (sectionId === "references") return `Got it. I’ve added the source material note.${nextText}`;
    if (sectionId === "constraints") return `Got it. I’ve added that as a constraint.${nextText}`;
    if (sectionId === "summary") return `I’ve turned that into a clearer goal.${nextText}`;
    return `That helps. I’ve updated the ${sectionLabel(sectionId)}.${nextText}`;
  }

  function completeSectionWithAnswer(brief, sectionId, key, answer) {
    const directSectionKey = briefKeyFromAssistantKey(key);
    const normalized = normalizeUserAnswer(directSectionKey, answer, brief);
    const nextBrief = updateBriefObject({ ...brief, updatedAt: new Date().toISOString() }, directSectionKey, normalized.value);
    const completed = new Set(completedSections());
    completed.add(sectionId);
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));

    const nextSectionId = nextOpenSectionId(sectionId, completed);
    if (nextSectionId) {
      const nextIndex = briefSectionIds().indexOf(nextSectionId);
      if (nextIndex >= 0) setActiveSectionIndex(nextIndex);
      const nextQuestion = questionForSection(nextSectionId, nextBrief);
      nextBrief.nextQuestion = nextQuestion;
      nextBrief.assistantMessage = normalizedAnswerMessage(sectionId, normalized.value, nextQuestion);
      nextBrief.stage = "clarifying_missing_info";
      nextBrief.readiness = "Almost Ready";
    } else {
      setActiveSectionIndex(briefSectionIds().length);
      nextBrief.nextQuestion = { key: "none", prompt: "", suggestions: [], placeholder: "" };
      nextBrief.assistantMessage = "That helps. Your Hatch is ready for a final look.";
      nextBrief.stage = "ready_to_post";
      nextBrief.readiness = "Ready to Post";
    }

    console.info("[Hatch debug] flow state", {
      activeSection: sectionId,
      normalizedValue: normalized.value,
      readyToSubmit: nextBrief.stage === "ready_to_post",
    });

    return nextBrief;
  }

  function validateSectionAnswer(key, answer = "", brief = {}) {
    const clean = normalizedAnswer(answer);
    const mappedKey = key === "objective" ? "summary" : key;
    const sectionName = {
      timeline: "timeline",
      budget: "budget",
      deliverables: "deliverables",
      title: "project title",
      businessType: "business",
      summary: "goal",
      industry: "industry",
      references: "references",
      constraints: "constraints",
    }[mappedKey] || "this part";

    if (mappedKey === "timeline" && !validTimelineAnswer(answer)) {
      const maybeFast = clean.includes("fast") || clean.includes("faste") || clean.includes("soon");
      return {
        ok: false,
        message: maybeFast
          ? "I think you mean quickly, but I need an actual timeline. Should I put this week, this month, or flexible?"
          : "I can’t use that as a timeline yet. A date, a range, or flexible works best.",
        question: validationQuestion("timeline"),
      };
    }

    if (mappedKey === "budget" && !validBudgetAnswer(answer)) {
      return {
        ok: false,
        message: "I can’t use that as a budget yet. A rough range is enough, or you can say flexible.",
        question: validationQuestion("budget"),
      };
    }

    if (mappedKey === "deliverables" && !validTextAnswer(answer, 4)) {
      return {
        ok: false,
        message: "I need a clearer output before I add it. For this Hatch, that could be captions, visuals, a posting plan, or all three.",
        question: validationQuestion("deliverables"),
      };
    }

    if (["title", "businessType", "summary", "industry"].includes(mappedKey) && !validTextAnswer(answer, 3)) {
      return {
        ok: false,
        message: `I can’t use that for the ${sectionName} yet. Give me a real word or short phrase for this part.`,
        question: validationQuestion(mappedKey),
      };
    }

    if (["references", "constraints"].includes(mappedKey)) {
      const emptyOkay = ["none", "no", "no references", "no references yet", "nothing", "skip", "skip for now"].includes(clean);
      if (!emptyOkay && !validTextAnswer(answer, 3)) {
        return {
          ok: false,
          message: `I can’t use that for ${sectionName} yet. You can add a real note, or say none for now.`,
          question: validationQuestion(mappedKey),
        };
      }
    }

    return { ok: true };
  }

  function affirmativeAnswer(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return ["yes", "yep", "yeah", "looks good", "good", "that works", "works", "ok", "okay", "perfect", "move on", "next"].includes(clean);
  }

  function skipAnswer(answer = "") {
    const clean = answer.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return ["skip", "skip for now", "leave it", "leave flexible", "keep flexible", "flexible", "not now", "no references yet"].includes(clean);
  }

  function ambiguousPlatformAnswer(answer = "") {
    const clean = answer.toLowerCase().trim();
    return ["instagram", "tiktok", "facebook", "linkedin", "website", "shopify", "canva"].includes(clean);
  }

  function contextualClarificationFallback(brief, key, answer) {
    const nextBrief = {
      ...brief,
      clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      knownRequirements: [...(brief.knownRequirements || []), `${key}: ${answer}`],
      updatedAt: new Date().toISOString(),
    };

    if (!uncertainAnswer(answer)) return null;

    if (key === "timeline") {
      const advice = uncertaintyForSection(brief, key);
      nextBrief.assistantMessage = advice.message;
      nextBrief.nextQuestion = advice.question;
      return nextBrief;
    }

    if (key === "budget") {
      const advice = uncertaintyForSection(brief, key);
      nextBrief.assistantMessage = advice.message;
      nextBrief.nextQuestion = advice.question;
      return nextBrief;
    }

    if (key === "references") {
      nextBrief.references = [...(nextBrief.references || []), "No references yet"];
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "references");
      nextBrief.assistantMessage = "No problem. We can leave references open for now.";
      return nextBrief;
    }

    if (key === "industry") {
      nextBrief.assistantMessage = "No worries. Could you tell me what kind of business or project this is for?";
      return nextBrief;
    }

    nextBrief.assistantMessage = "No worries. Tell me what you know, even if it’s rough.";
    return nextBrief;
  }

  function fallbackClarification(brief, key, answer) {
    if (!brief?.ok || !answer) return brief || { ok: false, error: "No project brief available." };

    const contextual = contextualClarificationFallback(brief, key, answer);
    if (contextual) return contextual;

    const directSectionKey = briefKeyFromAssistantKey(key);
    const sectionKeys = ["title", "businessType", "summary", "deliverables", "suggestedTimeline", "suggestedBudget", "industry", "references", "constraints"];
    const isSectionAnswer = sectionKeys.includes(directSectionKey);
    const validation = validateSectionAnswer(key, answer, brief);

    if (brief.isValidProject && uncertainAnswer(answer) && ["timeline", "budget", "deliverables"].includes(key)) {
      const advice = uncertaintyForSection(brief, key);
      return {
        ...brief,
        assistantMessage: advice.message,
        nextQuestion: advice.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
    }

    if (brief.isValidProject && adviceRequest(answer)) {
      const advice = adviceForSection(brief, key);
      return {
        ...brief,
        assistantMessage: advice.message,
        nextQuestion: advice.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
    }

    if (brief.isValidProject && !validation.ok && isSectionAnswer) {
      return {
        ...brief,
        assistantMessage: validation.message,
        nextQuestion: validation.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
    }

    if (!brief.isValidProject || brief.stage === "invalid_input" || (C.isLowQualityProjectInput(answer, []) && !isSectionAnswer)) {
      const recovered = recoveredBriefFromAnswer(answer, brief);
      if (recovered) return recovered;
      if (C.isLowQualityProjectInput(answer, [])) {
        return {
          ...brief,
          assistantMessage: key === "timeline"
            ? "I’ll keep us on timeline for a moment. You can say something like this week, next month, or flexible."
            : key === "budget"
              ? "I’ll keep us on budget for a moment. You can give a range, or say flexible."
              : key === "references"
                ? "That’s okay. If you don’t have examples, you can say no references yet."
                : invalidGuidance(answer, key),
        };
      }
      const generated = C.generateTaskBrief(answer, []);
      if (!generated.ok) return invalidProjectBrief(answer);
      return {
        ...generated,
        stage: "clarifying_missing_info",
        isValidProject: true,
        confidence: 55,
        assistantMessage: C.fallbackAssistantMessage(generated),
      };
    }

    const nextBrief = {
      ...brief,
      clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      knownRequirements: [...(brief.knownRequirements || []), `${key}: ${answer}`],
      updatedAt: new Date().toISOString(),
    };

    if (isSectionAnswer && validation.ok && !questionLike(answer) && !adviceRequest(answer)) {
      return completeSectionWithAnswer(brief, sectionIdForAssistantKey(key), key, answer);
    }

    if (key === "timeline") {
      nextBrief.suggestedTimeline = answer;
      nextBrief.timelineKnown = true;
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "timeline");
      nextBrief.assistantMessage = "That helps. I’ve updated the timeline.";
    }

    if (key === "budget") {
      nextBrief.suggestedBudget = answer;
      nextBrief.budgetKnown = true;
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "budget");
      nextBrief.assistantMessage = "That helps. I’ve updated the budget.";
    }

    if (key === "industry") {
      nextBrief.businessType = answer;
      nextBrief.industry = answer === "Other" ? "To be confirmed" : answer;
      nextBrief.summary = answer === "Other"
        ? brief.summary
        : `A practical ${answer.toLowerCase()} project ready for a Hatcher to review.`;
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "industry");
      nextBrief.assistantMessage = "That gives me a much clearer picture. I’ve updated the business context.";
    }

    if (key === "references") {
      if (answer !== "No references yet") nextBrief.references = [...(nextBrief.references || []), answer];
      nextBrief.missingInfo = removeMissingInfo(nextBrief, "references");
      nextBrief.assistantMessage = answer === "No references yet"
        ? "No problem. We can leave references open for now."
        : "Perfect. I’ve added that as a reference.";
    }

    return nextBrief;
  }

  async function answerClarification(key, value = "") {
    const inputValue = document.getElementById("clarificationAnswer")?.value.trim() || "";
    const answer = (value || inputValue).trim();
    const brief = getGeneratedBrief();
    if (!brief?.ok || !answer) return;

    const nextBrief = await requestProjectIntake({
      mode: "clarify",
      brief,
      key,
      answer,
    });

    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    render();
  }

  async function sendAssistantReply(value = "") {
    const input = document.getElementById("assistantReply");
    const answer = (value || input?.value || "").trim();
    const brief = getGeneratedBrief();
    if (!brief?.ok || !answer) return;

    const sectionId = activeSectionId();
    const key = assistantKeyForSection(sectionId);
    const existingMessages = getAssistantMessages();

    if (affirmativeAnswer(answer)) {
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: "Nice, I’ll move us to the next part." }]);
      confirmSection(sectionId);
      return;
    }

    if (skipAnswer(answer)) {
      const briefCopy = { ...brief };
      if (sectionId === "suggestedTimeline") updateBriefObject(briefCopy, sectionId, "Flexible");
      if (sectionId === "suggestedBudget") updateBriefObject(briefCopy, sectionId, "Flexible");
      if (sectionId === "references") updateBriefObject(briefCopy, sectionId, "No references yet");
      if (sectionId === "constraints") updateBriefObject(briefCopy, sectionId, "None for now");
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(briefCopy));
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: "No worries. I’ll keep this flexible and move us along." }]);
      confirmSection(sectionId);
      return;
    }

    if (ambiguousPlatformAnswer(answer) && ["summary", "deliverables", "constraints"].includes(sectionId)) {
      saveAssistantMessages([
        ...existingMessages,
        { role: "user", text: answer },
        { role: "assistant", text: `Got it — ${answer} is the platform. Do you mean content creation, account management, ads, or growth strategy?` },
      ]);
      return;
    }

    if (brief.isValidProject && correctionIntent(answer)) {
      const recentTopic = recentTopicFromMessages(existingMessages);
      if (recentTopic) {
        const correctedSectionId = sectionIdForAssistantKey(recentTopic);
        const correctedIndex = briefSectionIds().indexOf(correctedSectionId);
        if (correctedIndex >= 0) setActiveSectionIndex(correctedIndex);
        const advice = adviceForSection(brief, recentTopic);
        const nextBrief = {
          ...brief,
          assistantMessage: advice.message,
          nextQuestion: advice.question,
          clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
        };
        localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
        saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: advice.message }]);
        render();
        return;
      }
    }

    if (brief.isValidProject && uncertainAnswer(answer) && ["timeline", "budget", "deliverables"].includes(key)) {
      const advice = uncertaintyForSection(brief, key);
      const nextBrief = {
        ...brief,
        assistantMessage: advice.message,
        nextQuestion: advice.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: advice.message }]);
      render();
      return;
    }

    if (brief.isValidProject && adviceRequest(answer)) {
      const advice = adviceForSection(brief, key);
      const nextBrief = {
        ...brief,
        assistantMessage: advice.message,
        nextQuestion: advice.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: advice.message }]);
      render();
      return;
    }

    if (!brief.isValidProject || brief.stage === "invalid_input" || Number(brief.confidence || 0) < 40) {
      const recovered = recoveredBriefFromAnswer(answer, brief);
      if (recovered) {
        mergeInferredProgress(recovered);
        localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(recovered));
        saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: recovered.assistantMessage }]);
        render();
        return;
      }
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: invalidGuidance(answer, key) }]);
      render();
      return;
    }

    const validation = validateSectionAnswer(key, answer, brief);
    if (!validation.ok) {
      const nextBrief = {
        ...brief,
        assistantMessage: validation.message,
        nextQuestion: validation.question,
        clarificationCount: Math.min((brief.clarificationCount || 0) + 1, 5),
      };
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: validation.message }]);
      render();
      return;
    }

    if (brief.isValidProject && validation.ok && !questionLike(answer) && !adviceRequest(answer)) {
      const nextBrief = completeSectionWithAnswer(brief, sectionId, key, answer);
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
      saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: nextBrief.assistantMessage }]);
      render();
      return;
    }

    const pendingMessages = [...existingMessages, { role: "user", text: answer }, { role: "assistant", text: "That helps. I’m updating the brief..." }];
    saveAssistantMessages(pendingMessages);
    render();

    const result = await requestProjectAssistant({
      brief,
      messages: existingMessages,
      key,
      sectionId,
      answer,
    });

    const nextBrief = normalizeProjectBrief(result.brief || result, { mode: "clarify", brief });
    const assistantText = result.assistantMessage || result.assistant_message || nextBrief.assistantMessage || C.fallbackAssistantMessage(nextBrief);
    mergeInferredProgress(nextBrief);
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    saveAssistantMessages([...existingMessages, { role: "user", text: answer }, { role: "assistant", text: assistantText }]);
    if (nextBrief.completedSectionId) {
      const completed = new Set(completedSections());
      completed.add(nextBrief.completedSectionId);
      localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
      moveToNextSection();
      return;
    }
    render();
  }

  function updateBriefObject(nextBrief, key, value) {
    const scalarValue = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean).join(", ")
      : String(value || "").trim();
    const listValue = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : String(value || "")
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

    if (key === "title") nextBrief.title = scalarValue;
    if (key === "summary") nextBrief.summary = scalarValue;
    if (key === "businessType") nextBrief.businessType = scalarValue;
    if (key === "industry") nextBrief.industry = scalarValue;
    if (key === "suggestedBudget") {
      nextBrief.suggestedBudget = scalarValue;
      nextBrief.budgetKnown = Boolean(scalarValue);
    }
    if (key === "suggestedTimeline") {
      nextBrief.suggestedTimeline = scalarValue;
      nextBrief.timelineKnown = Boolean(scalarValue);
    }
    if (key === "suggestedLevel") nextBrief.suggestedLevel = scalarValue || "L1";
    if (key === "deliverables") nextBrief.deliverables = listValue;
    if (key === "references") nextBrief.references = listValue;
    if (key === "constraints") nextBrief.constraints = listValue;

    const missing = new Set(nextBrief.missingInfo || []);
    if (nextBrief.title && nextBrief.summary) missing.delete("objective");
    if (nextBrief.businessType || nextBrief.industry) missing.delete("industry");
    if (nextBrief.deliverables?.length) missing.delete("deliverables");
    if (nextBrief.suggestedBudget) missing.delete("budget");
    if (nextBrief.suggestedTimeline) missing.delete("timeline");
    nextBrief.missingInfo = [...missing];
    if (nextBrief.title || nextBrief.summary || nextBrief.deliverables?.length) {
      nextBrief.isValidProject = true;
      nextBrief.confidence = Math.max(Number(nextBrief.confidence || 0), 55);
      nextBrief.stage = nextBrief.missingInfo.length ? "clarifying_missing_info" : "ready_to_post";
      nextBrief.readiness = nextBrief.missingInfo.length ? "Almost Ready" : "Ready to Post";
    }
    if (nextBrief.isValidProject && !nextBrief.missingInfo.length) {
      nextBrief.stage = "ready_to_post";
      nextBrief.readiness = "Ready to Post";
      nextBrief.nextQuestion = { key: "none", prompt: "", suggestions: [], placeholder: "" };
    }

    return nextBrief;
  }

  function updateBriefField(key, value) {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const nextBrief = updateBriefObject({ ...brief, updatedAt: new Date().toISOString() }, key, value);

    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    localStorage.removeItem("hatchBriefEditKey");
    render();
  }

  function sectionMessages() {
    return readJson("hatchSectionMessages", {});
  }

  function saveSectionMessage(sectionId, message) {
    const messages = sectionMessages();
    messages[sectionId] = [...(messages[sectionId] || []), message].slice(-4);
    localStorage.setItem("hatchSectionMessages", JSON.stringify(messages));
  }

  function completedSections() {
    return readJson("hatchCompletedSections", []);
  }

  function setActiveSectionIndex(index) {
    localStorage.setItem("hatchActiveSectionIndex", String(Math.max(0, index)));
  }

  function briefSectionIds() {
    return ["title", "businessType", "summary", "deliverables", "suggestedTimeline", "suggestedBudget", "industry", "references", "constraints"];
  }

  function activeSectionId() {
    const ids = briefSectionIds();
    const index = Number(localStorage.getItem("hatchActiveSectionIndex") || 0);
    return ids[index] || "general";
  }

  function assistantKeyForSection(sectionId) {
    return {
      suggestedTimeline: "timeline",
      suggestedBudget: "budget",
    }[sectionId] || sectionId;
  }

  function confirmSection(sectionId) {
    const brief = getGeneratedBrief();
    if (brief?.ok && (sectionId === "suggestedTimeline" || sectionId === "suggestedBudget")) {
      const nextBrief = { ...brief };
      if (sectionId === "suggestedTimeline" && nextBrief.suggestedTimeline) {
        nextBrief.timelineKnown = true;
        nextBrief.missingInfo = removeMissingInfo(nextBrief, "timeline");
      }
      if (sectionId === "suggestedBudget" && nextBrief.suggestedBudget) {
        nextBrief.budgetKnown = true;
        nextBrief.missingInfo = removeMissingInfo(nextBrief, "budget");
      }
      localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    }
    const completed = new Set(completedSections());
    completed.add(sectionId);
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
    saveSectionMessage(sectionId, "Nice, that’s enough for this section.");
    if (localStorage.getItem("hatchReturnToFinalReview") === "true") {
      setActiveSectionIndex(briefSectionIds().length);
      localStorage.removeItem("hatchReturnToFinalReview");
      localStorage.removeItem("hatchBriefEditKey");
      render();
      return;
    }
    moveToNextSection();
  }

  function moveToNextSection() {
    const ids = briefSectionIds();
    const completed = new Set(completedSections());
    const current = Number(localStorage.getItem("hatchActiveSectionIndex") || 0);
    const next = ids.findIndex((id, index) => index > current && !completed.has(id));
    setActiveSectionIndex(next === -1 ? ids.length : next);
    localStorage.removeItem("hatchBriefEditKey");
    render();
  }

  function editBriefField(key) {
    localStorage.setItem("hatchBriefEditKey", key);
    render();
  }

  function editSection(sectionId) {
    const index = briefSectionIds().indexOf(sectionId);
    if (index >= 0) setActiveSectionIndex(index);
    editBriefField(sectionId);
    saveSectionMessage(sectionId, "No worries — write this however you like. I’ll clean it up after.");
  }

  function cancelBriefEdit() {
    localStorage.removeItem("hatchBriefEditKey");
    render();
  }

  function updateSection(sectionId, value) {
    saveSectionMessage(sectionId, "That helps. I’ve updated this section.");
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const normalized = normalizeUserAnswer(sectionId, value, brief);
    const nextBrief = updateBriefObject({ ...brief, updatedAt: new Date().toISOString() }, sectionId, normalized.value);
    nextBrief.assistantMessage = "That helps — I cleaned it up a little below.";
    const completed = new Set(completedSections());
    completed.add(sectionId);
    localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    localStorage.removeItem("hatchBriefEditKey");
    if (localStorage.getItem("hatchReturnToFinalReview") === "true") {
      setActiveSectionIndex(briefSectionIds().length);
      localStorage.removeItem("hatchReturnToFinalReview");
    }
    saveAssistantMessages([...getAssistantMessages(), { role: "assistant", text: nextBrief.assistantMessage }]);
    render();
  }

  function rewriteSection(sectionId) {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const nextBrief = { ...brief };
    const source = brief.sourceText || localStorage.getItem("skillnestDraftTask") || "";
    const current = {
      title: brief.title,
      businessType: brief.businessType,
      summary: brief.summary,
      deliverables: brief.deliverables,
      suggestedTimeline: brief.suggestedTimeline,
      suggestedBudget: brief.suggestedBudget,
      industry: brief.industry,
      references: brief.references,
      constraints: brief.constraints,
    }[sectionId];

    const fallbackText = source.length > 80 ? source.slice(0, 120).trim() : source.trim();
    if (sectionId === "title") nextBrief.title = polishSectionValue(sectionId, brief, brief.title || C.buildTaskBrief(source).title || "Clear project brief");
    if (sectionId === "businessType") nextBrief.businessType = polishSectionValue(sectionId, brief, brief.businessType && brief.businessType !== "To be confirmed" ? brief.businessType : (brief.industry || "Business to confirm"));
    if (sectionId === "summary") nextBrief.summary = polishSectionValue(sectionId, brief, brief.summary || fallbackText || "Turn the idea into a clear, usable result.");
    if (sectionId === "deliverables") nextBrief.deliverables = Array.isArray(current) && current.length ? current : ["Clear first draft", "Editable final files", "Notes for handoff"];
    if (sectionId === "suggestedTimeline") {
      nextBrief.suggestedTimeline = brief.suggestedTimeline || "Flexible";
      nextBrief.timelineKnown = true;
    }
    if (sectionId === "suggestedBudget") {
      nextBrief.suggestedBudget = brief.suggestedBudget || "Flexible";
      nextBrief.budgetKnown = true;
    }
    if (sectionId === "industry") nextBrief.industry = brief.industry && brief.industry !== "General business" ? brief.industry : "General";
    if (sectionId === "references") nextBrief.references = Array.isArray(current) && current.length ? current : ["No references yet"];
    if (sectionId === "constraints") nextBrief.constraints = Array.isArray(current) && current.length ? current : ["Keep it simple and easy to use"];

    nextBrief.missingInfo = (nextBrief.missingInfo || []).filter((item) => item !== sectionId);
    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
    saveSectionMessage(sectionId, "Here’s a tighter version.");
    saveAssistantMessages([...getAssistantMessages(), { role: "assistant", text: "Here’s a tighter version." }]);
    render();
  }

  function polishSectionValue(sectionId, brief, value) {
    const text = String(value || "").trim();
    if (sectionId === "title") return text.replace(/\s+/g, " ").replace(/\.$/, "") || "Clear project brief";
    if (sectionId === "businessType") return text || brief.industry || "Business to confirm";
    if (sectionId === "summary") {
      if (!text) return "Create a clear, usable result that matches the client’s goal.";
      return text.length > 180 ? `${text.slice(0, 177).trim()}...` : text;
    }
    if (sectionId === "suggestedTimeline") return text || "Flexible";
    if (sectionId === "suggestedBudget") return text || "Flexible";
    if (sectionId === "industry") return text || "General";
    if (sectionId === "references") return text || "No references yet";
    if (sectionId === "constraints") return text || "Keep the work simple and easy to use";
    return text;
  }

  function handleAssistantReplyKey(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    sendAssistantReply();
  }

  function updateLiveTaskPreview() {
    const prompt = document.getElementById("taskPrompt");
    const target = document.getElementById("taskLivePreview");
    if (!target) return;
    target.innerHTML = C.taskPreviewMarkup(prompt?.value || "", readJson("skillnestDraftFiles", []));
  }

  function renderFilePreviews() {
    const lists = [...document.querySelectorAll("[data-file-preview]")];
    const files = readJson("skillnestDraftFiles", []);
    const labelOptions = ["Services and prices", "Photos/logo", "Existing website", "Menu/items", "Brand examples", "Notes", "Other material"];
    if (!lists.length) return;
    if (!files.length) {
      lists.forEach((list) => {
        list.innerHTML = list.classList.contains("review-file-preview-list")
          ? `<div class="file-preview-empty">No files attached yet</div>`
          : "";
      });
      return;
    }
    const markup = files.map((file, index) => {
      const size = file.size ? `${Math.ceil(file.size / 1024)} KB` : "Size unavailable";
      const type = file.type || "file";
      const materialType = file.materialType || "Other material";
      return `
        <article class="file-preview">
          <div>
            <strong>${C.escapeHtml(file.name || file)}</strong>
            <span>${C.escapeHtml(type)} · ${size}</span>
            <label class="file-label-control">
              <span>Label</span>
              <select onchange="SkillNestApp.updateDraftFileLabel(${index}, this.value)">
                ${labelOptions.map((option) => `<option value="${C.escapeHtml(option)}"${option === materialType ? " selected" : ""}>${C.escapeHtml(option)}</option>`).join("")}
                ${labelOptions.includes(materialType) ? "" : `<option value="${C.escapeHtml(materialType)}" selected>${C.escapeHtml(materialType)}</option>`}
              </select>
            </label>
          </div>
          <button class="btn ghost small danger" type="button" onclick="SkillNestApp.removeDraftFile(${index})">Remove</button>
        </article>
      `;
    }).join("");
    lists.forEach((list) => {
      list.innerHTML = markup;
    });
  }

  function syncFilesIntoBrief(files, options = {}) {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    const existingReferences = Array.isArray(brief.references) ? brief.references : [];
    const references = [...new Set([
      ...existingReferences.filter((item) => !String(item || "").startsWith("Attached ")),
      ...files.map((file) => `Attached ${file.materialType || "file"}: ${file.name || file}`),
    ])];
    const nextBrief = {
      ...brief,
      files,
      references,
      updatedAt: new Date().toISOString(),
    };
    nextBrief.missingInfo = removeMissingInfo(nextBrief, "references");

    if (options.completeReferences && activeSectionId() === "references") {
      const completed = new Set(completedSections());
      completed.add("references");
      localStorage.setItem("hatchCompletedSections", JSON.stringify([...completed]));
      const nextSectionId = nextOpenSectionId("references", completed);
      if (nextSectionId) {
        const nextIndex = briefSectionIds().indexOf(nextSectionId);
        if (nextIndex >= 0) setActiveSectionIndex(nextIndex);
        const nextQuestion = questionForSection(nextSectionId, nextBrief);
        nextBrief.nextQuestion = nextQuestion;
        nextBrief.assistantMessage = `I’ve added the files as source material. Next, ${nextQuestion.prompt.charAt(0).toLowerCase()}${nextQuestion.prompt.slice(1)}`;
      } else {
        setActiveSectionIndex(briefSectionIds().length);
        nextBrief.assistantMessage = "I’ve added the files as source material. Your Hatch is ready for a final look.";
        nextBrief.stage = "ready_to_post";
        nextBrief.readiness = "Ready to Post";
      }
      saveAssistantMessages([...getAssistantMessages(), { role: "assistant", text: nextBrief.assistantMessage }]);
    }

    localStorage.setItem("skillnestGeneratedBrief", JSON.stringify(nextBrief));
  }

  function attachReferenceMaterial(materialType = "Other material") {
    localStorage.setItem("hatchPendingFileMaterial", materialType);
    document.getElementById("reviewTaskFile")?.click();
  }

  function updateDraftFileLabel(index, materialType) {
    const files = readJson("skillnestDraftFiles", []);
    if (!files[index]) return;
    files[index] = { ...files[index], materialType };
    localStorage.setItem("skillnestDraftFiles", JSON.stringify(files));
    syncFilesIntoBrief(files);
    renderFilePreviews();
    if (currentRoute() === "task-review") render();
  }

  function useTaskChip(text) {
    const prompt = document.getElementById("taskPrompt");
    if (prompt) {
      prompt.value = text;
      updateLiveTaskPreview();
    }
  }

  function useExampleTask() {
    const prompt = document.getElementById("taskPrompt");
    if (!prompt) return;
    const exampleText = "I run a small cafe and need a Hatcher to turn my menu and daily specials into 30 Instagram captions, a simple posting calendar, and a few Canva template ideas.";
    prompt.value = prompt.value.trim() ? `${prompt.value.trim()}\n\n${exampleText}` : exampleText;
    const summary = document.getElementById("fileSummary");
    if (summary) {
      summary.textContent = "Example added. Edit it before continuing.";
      summary.classList.add("show");
    }
    updateLiveTaskPreview();
  }

  function setVoiceStatus(message, state = "") {
    const status = document.getElementById("voiceStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `voice-status show ${state}`.trim();
  }

  function appendTranscript(text) {
    const prompt = document.getElementById("taskPrompt");
    if (!prompt || !text.trim()) return;
    const cleanText = text.trim();
    prompt.value = prompt.value.trim() ? `${prompt.value.trim()} ${cleanText}` : cleanText;
    voiceSessionText = voiceSessionText ? `${voiceSessionText} ${cleanText}` : cleanText;
    saveDraftTask();
    updateLiveTaskPreview();
  }

  function updateVoiceControls() {
    const button = document.getElementById("voiceInputButton");
    const pauseButton = document.getElementById("voicePauseButton");
    const stopButton = document.getElementById("voiceStopButton");
    const deleteButton = document.getElementById("voiceDeleteButton");

    if (button) {
      button.textContent = isVoiceListening ? "Listening..." : isVoicePaused ? "Resume voice" : "Voice input";
      button.disabled = isVoiceListening;
    }
    pauseButton?.classList.toggle("hidden", !isVoiceListening);
    stopButton?.classList.toggle("hidden", !isVoiceListening && !isVoicePaused);
    deleteButton?.classList.toggle("hidden", !voiceSessionText.trim());
  }

  function resetVoiceSession() {
    isVoiceListening = false;
    isVoicePaused = false;
    updateVoiceControls();
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus("Voice input is not supported in this browser yet.", "error");
      return;
    }

    isVoicePaused = false;
    if (!voiceRecognition) {
      voiceRecognition = new SpeechRecognition();
      voiceRecognition.lang = "en-US";
      voiceRecognition.interimResults = true;
      voiceRecognition.continuous = true;
    }
    voiceHadTranscript = false;

    // Backend-ready: for production, send audio to a secure server route for transcription.
    voiceRecognition.onstart = () => {
      isVoiceListening = true;
      isVoicePaused = false;
      updateVoiceControls();
      setVoiceStatus("Listening. Pause or stop whenever you’re done.", "listening");
    };

    voiceRecognition.onresult = (event) => {
      const transcript = [...event.results]
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      appendTranscript(transcript);
      voiceHadTranscript = Boolean(transcript);
      if (voiceHadTranscript) setVoiceStatus("Transcript added. Keep speaking, pause, or stop when ready.", "success");
      updateVoiceControls();
    };

    voiceRecognition.onerror = (event) => {
      const message = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone permission was denied."
        : "Voice input paused. You can resume or type instead.";
      setVoiceStatus(message, "error");
      isVoiceListening = false;
      isVoicePaused = event.error !== "not-allowed" && event.error !== "service-not-allowed";
      updateVoiceControls();
    };

    voiceRecognition.onend = () => {
      isVoiceListening = false;
      if (!isVoicePaused && voiceRecognition) {
        try {
          voiceRecognition.start();
          return;
        } catch {
          setVoiceStatus(voiceHadTranscript ? "Voice input paused. You can resume or continue typing." : "Voice input paused. No transcript was added yet.", "");
          isVoicePaused = true;
        }
      } else if (!voiceHadTranscript && !voiceSessionText.trim()) {
        setVoiceStatus("Voice input paused. No transcript was added yet.", "");
      }
      updateVoiceControls();
    };

    try {
      voiceRecognition.start();
    } catch {
      setVoiceStatus("Voice input could not start. Try again in a moment.", "error");
      resetVoiceSession();
    }
  }

  function stopVoiceInput() {
    isVoicePaused = true;
    if (voiceRecognition && isVoiceListening) voiceRecognition.stop();
    isVoiceListening = false;
    setVoiceStatus(voiceSessionText.trim() ? "Voice input stopped. You can edit the text before continuing." : "Voice input stopped.", voiceSessionText.trim() ? "success" : "");
    updateVoiceControls();
  }

  function pauseVoiceInput() {
    isVoicePaused = true;
    if (voiceRecognition && isVoiceListening) voiceRecognition.stop();
    isVoiceListening = false;
    setVoiceStatus("Voice input paused. Resume when you’re ready.", "");
    updateVoiceControls();
  }

  function deleteVoiceTranscript() {
    const prompt = document.getElementById("taskPrompt");
    if (prompt && voiceSessionText.trim()) {
      const escaped = voiceSessionText.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      prompt.value = prompt.value
        .replace(new RegExp(`\\s*${escaped}\\s*`, "g"), " ")
        .replace(/\s+/g, " ")
        .trim();
      saveDraftTask();
      updateLiveTaskPreview();
    }
    voiceSessionText = "";
    setVoiceStatus("Voice text deleted.", "");
    updateVoiceControls();
  }

  function toggleVoiceInput() {
    if (!isVoiceListening) startVoiceInput();
  }

  function simulateVoiceInput() {
    useExampleTask();
  }

  function handleTaskFiles(event) {
    const existing = readJson("skillnestDraftFiles", []);
    const materialType = localStorage.getItem("hatchPendingFileMaterial") || "Other material";
    const files = [...event.target.files].map((file) => ({
      name: file.name,
      type: file.type || "file",
      size: file.size || 0,
      materialType,
    }));
    const nextFiles = [...existing, ...files];
    localStorage.setItem("skillnestDraftFiles", JSON.stringify(nextFiles));
    localStorage.removeItem("hatchPendingFileMaterial");
    const summary = document.getElementById("fileSummary");
    if (summary) {
      summary.textContent = nextFiles.length ? `${nextFiles.length} file${nextFiles.length === 1 ? "" : "s"} attached for preview.` : "";
      summary.classList.toggle("show", nextFiles.length > 0);
    }
    event.target.value = "";
    syncFilesIntoBrief(nextFiles);
    renderFilePreviews();
    updateLiveTaskPreview();
    if (currentRoute() === "task-review") render();
  }

  function completeReferenceFiles() {
    const files = readJson("skillnestDraftFiles", []);
    if (!files.length) return;
    syncFilesIntoBrief(files, { completeReferences: true });
    render();
  }

  function removeDraftFile(index) {
    const files = readJson("skillnestDraftFiles", []);
    files.splice(index, 1);
    localStorage.setItem("skillnestDraftFiles", JSON.stringify(files));
    const summary = document.getElementById("fileSummary");
    if (summary) {
      summary.textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} attached for preview.` : "";
      summary.classList.toggle("show", files.length > 0);
    }
    renderFilePreviews();
    updateLiveTaskPreview();
    if (currentRoute() === "task-review") {
      syncFilesIntoBrief(files);
      render();
    }
  }

  function confirmTaskReview() {
    const brief = getGeneratedBrief();
    const reviewedText = brief?.sourceText || localStorage.getItem("skillnestDraftTask") || "";
    localStorage.setItem("skillnestDraftTask", reviewedText);
    setRoute(isLoggedIn() ? "post-task" : "auth");
  }

  function reviewedBriefToPostedTask(brief) {
    const files = readJson("skillnestDraftFiles", []);
    const industry = brief.industry || brief.businessType || "General";
    return {
      id: `hatch-${Date.now()}`,
      title: brief.title || "New Hatch",
      business: brief.businessType || industry,
      objective: brief.summary || "Create a practical solution.",
      description: brief.summary || "",
      budget: brief.suggestedBudget || "Flexible / needs guidance",
      deadline: brief.suggestedTimeline || "Flexible",
      timeline: brief.suggestedTimeline || "Flexible",
      estimatedCompletion: brief.suggestedTimeline || "Flexible",
      industry,
      category: industry,
      level: brief.suggestedLevel || "L1",
      status: "New Hatch",
      deliverables: brief.deliverables || [],
      references: brief.references || [],
      constraints: brief.constraints || [],
      recommendedHatcherType: brief.recommendedHatcherType || brief.suggestedLevel || "L1",
      files,
      createdAt: new Date().toISOString(),
    };
  }

  function submitReviewedHatch() {
    const brief = getGeneratedBrief();
    if (!brief?.ok) return;
    if (!isLoggedIn()) {
      localStorage.setItem("hatchPendingSubmit", "true");
      localStorage.setItem("hatchAuthReturn", "submit-reviewed-hatch");
      setRoute("auth");
      return;
    }

    const postedTask = reviewedBriefToPostedTask(brief);
    saveListItem("skillnestPostedTasks", postedTask, "id");
    localStorage.setItem("hatchProfileNotice", "Your Hatch has been submitted.");
    localStorage.setItem("hatchBrowseNotice", "Your Hatch has been submitted and is now listed here.");
    localStorage.removeItem("hatchPendingSubmit");
    localStorage.removeItem("hatchAuthReturn");
    clearTaskDraft({ redirect: false });
    setRoute("browse");
  }

  function saveHatchDraft() {
    localStorage.setItem("hatchDraftSavedAt", new Date().toISOString());
    saveAssistantMessages([...getAssistantMessages(), { role: "assistant", text: "Draft saved. You can come back and finish it later." }]);
    render();
  }

  function toggleFinalEditList() {
    const current = localStorage.getItem("hatchShowFinalEditSections") === "true";
    localStorage.setItem("hatchShowFinalEditSections", current ? "false" : "true");
    render();
  }

  function editFinalSection(sectionId) {
    localStorage.setItem("hatchReturnToFinalReview", "true");
    localStorage.setItem("hatchShowFinalEditSections", "false");
    editSection(sectionId);
  }

  function clearTaskDraft(options = {}) {
    localStorage.removeItem("skillnestDraftTask");
    localStorage.removeItem("skillnestDraftFiles");
    localStorage.removeItem("skillnestGeneratedBrief");
    localStorage.removeItem("hatchAssistantMessages");
    localStorage.removeItem("hatchActiveSectionIndex");
    localStorage.removeItem("hatchCompletedSections");
    localStorage.removeItem("hatchSectionMessages");
    localStorage.removeItem("hatchBriefEditKey");
    localStorage.removeItem("hatchShowFinalEditSections");
    localStorage.removeItem("hatchReturnToFinalReview");
    if (options.redirect !== false) setRoute("home");
  }

  function completeLogin(event) {
    event.preventDefault();
    const account = getAccount();
    const usernameOrEmail = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const matchesIdentity = usernameOrEmail === account.username || usernameOrEmail === account.email;
    const matchesPassword = !account.password || password === account.password;
    if (!matchesIdentity || !matchesPassword) {
      document.getElementById("loginError")?.classList.add("show");
      return;
    }
    localStorage.setItem("skillnestLoggedIn", "true");
    if (localStorage.getItem("hatchPendingSubmit") === "true") {
      submitReviewedHatch();
      return;
    }
    if (completePendingMission()) return;
    setRoute(accountRoute(account));
  }

  function completeSignup(event) {
    event.preventDefault();
    const account = {
      username: document.getElementById("authUsername").value.trim(),
      name: document.getElementById("authName").value.trim(),
      email: document.getElementById("authEmail").value.trim(),
      password: document.getElementById("authPassword").value,
      role: document.getElementById("authRole").value,
      joinedAt: new Date().toISOString(),
    };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    localStorage.setItem("skillnestLoggedIn", "true");
    if (localStorage.getItem("hatchPendingSubmit") === "true") {
      submitReviewedHatch();
      return;
    }
    if (completePendingMission()) return;
    setRoute(accountRoute(account));
  }

  function quickTestLogin() {
    const account = {
      username: "test_hatcher",
      name: "Test Hatcher",
      email: "test@hatch.local",
      password: "test",
      role: "Client and Hatcher",
      provider: "Quick test login",
      joinedAt: new Date().toISOString(),
    };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    localStorage.setItem("skillnestLoggedIn", "true");
    if (localStorage.getItem("hatchPendingSubmit") === "true") {
      submitReviewedHatch();
      return;
    }
    if (completePendingMission()) return;
    setRoute("profile");
  }

  function socialLogin() {
    document.getElementById("loginError")?.classList.add("show");
  }

  function logout() {
    localStorage.removeItem("skillnestLoggedIn");
    setRoute("home");
    render();
  }

  function toggleChoice(event, button) {
    event.preventDefault();
    const isPressed = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", String(!isPressed));
    button.classList.toggle("selected", !isPressed);
  }

  function addCustomChoice(event, name) {
    event.preventDefault();
    const fieldset = event.currentTarget.closest(".choice-field");
    const input = fieldset?.querySelector(`[name="${name}Other"]`);
    const options = fieldset?.querySelector(".choice-options");
    const value = input?.value.trim();
    if (!value || !options) return;

    const button = document.createElement("button");
    button.className = "choice-pill custom-choice selected";
    button.type = "button";
    button.name = name;
    button.value = value;
    button.setAttribute("aria-pressed", "true");
    button.onclick = (clickEvent) => toggleChoice(clickEvent, button);
    button.innerHTML = `${C.escapeHtml(value)} <span class="remove-choice" onclick="SkillNestApp.removeCustomChoice(event, this)">x</span>`;
    options.appendChild(button);
    input.value = "";
  }

  function removeCustomChoice(event, control) {
    event.preventDefault();
    event.stopPropagation();
    control.closest(".choice-pill")?.remove();
  }

  function applyTaskFilters() {
    const query = (document.getElementById("taskSearch")?.value || "").toLowerCase();
    const level = document.getElementById("levelFilter")?.value || "";
    const industry = document.getElementById("industryFilter")?.value || "";
    const cards = [...document.querySelectorAll("#browseTaskGrid .task-card")];
    let visibleCount = 0;

    cards.forEach((card) => {
      const isVisible =
        (!query || card.dataset.search.toLowerCase().includes(query)) &&
        (!level || card.dataset.level === level) &&
        (!industry || card.dataset.industry === industry);
      card.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });

    document.getElementById("emptyTasks")?.classList.toggle("show", visibleCount === 0);
  }

  function saveMission(taskId, status) {
    if (!isLoggedIn()) {
      localStorage.setItem("hatchPendingMission", JSON.stringify({ taskId, status }));
      setRoute("auth");
      return;
    }
    const task = marketplaceTasks().find((item) => item.id === taskId);
    if (!task) return;
    saveListItem("skillnestMissions", { ...task, status, updatedAt: new Date().toISOString() }, "id");
    updateTaskCardState(taskId, status);
    const feedback = document.getElementById("taskFeedback");
    if (feedback) {
      feedback.textContent = status === "Incubating" || status === "Accepted" ? "Hatch added to your Hatcher Hatches." : "Hatch saved to your profile.";
      feedback.classList.add("show");
    }
  }

  function completePendingMission() {
    const pending = readJson("hatchPendingMission", null);
    if (!pending?.taskId) return false;
    const task = marketplaceTasks().find((item) => item.id === pending.taskId);
    localStorage.removeItem("hatchPendingMission");
    if (!task) return false;
    const status = pending.status || "Saved";
    saveListItem("skillnestMissions", { ...task, status, updatedAt: new Date().toISOString() }, "id");
    localStorage.setItem(
      "hatchProfileNotice",
      status === "Incubating" || status === "Accepted"
        ? "Hatch added to your Hatcher Hatches."
        : "Hatch saved to your profile."
    );
    setRoute("profile");
    return true;
  }

  function updateTaskCardState(taskId, status) {
    document.querySelectorAll(`[data-task-id="${taskId}"]`).forEach((card) => {
      card.classList.add(status === "Incubating" || status === "Accepted" ? "mission-accepted" : "mission-saved");
      const saveButton = card.querySelector(".save-action");
      const applyButton = card.querySelector(".apply-action");
      if (saveButton) saveButton.textContent = "Saved";
      if (applyButton && (status === "Incubating" || status === "Accepted")) {
        applyButton.textContent = "Incubating";
        applyButton.disabled = true;
      }
    });
  }

  function syncMissionCardStates() {
    getMissions().forEach((mission) => {
      if (mission.id) updateTaskCardState(mission.id, mission.status);
    });
  }

  function removeMission(identifier) {
    const missions = getMissions().filter((mission) => mission.id !== identifier && encodeURIComponent(mission.title) !== identifier);
    localStorage.setItem("skillnestMissions", JSON.stringify(missions));
    render();
  }

  function deletePostedTask(identifier) {
    if (!window.confirm("Delete this posted Hatch?")) return;
    const postedTasks = getPostedTasks().filter((task) => task.id !== identifier && encodeURIComponent(task.title) !== identifier);
    localStorage.setItem("skillnestPostedTasks", JSON.stringify(postedTasks));
    render();
  }

  function submitTask(event) {
    event.preventDefault();
    const industry = document.getElementById("industry").value;
    const generatedBrief = getGeneratedBrief();
    const taskDescription = document.getElementById("taskDetails").value.trim();
    const postedTask = {
      id: `posted-${Date.now()}`,
      title: generatedBrief?.title || taskDescription || "Untitled Hatch",
      business: document.getElementById("businessType").value.trim(),
      objective: taskDescription || generatedBrief?.summary || "Create a practical business solution.",
      budget: document.getElementById("budgetRange").value,
      deadline: document.getElementById("deadline").value,
      timeline: document.getElementById("deadline").value,
      estimatedCompletion: document.getElementById("deadline").value,
      industry,
      category: industry,
      level: "L1",
      status: "New Hatch",
      createdAt: new Date().toISOString(),
    };
    saveListItem("skillnestPostedTasks", postedTask, "id");
    localStorage.removeItem("skillnestDraftTask");
    localStorage.removeItem("skillnestGeneratedBrief");
    document.getElementById("taskSuccess")?.classList.add("show");
    const recommendations = document.getElementById("recommendedOperators");
    if (recommendations) recommendations.innerHTML = C.recommendedOperators(industry);
  }

  function submitOperator(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const selectedValues = (name) => {
      const selected = [...form.querySelectorAll(`[name="${name}"].selected`)].map((button) => button.value);
      const other = form.querySelector(`[name="${name}Other"]`)?.value.trim();
      return other ? [...selected, other].join(", ") : selected.join(", ");
    };
    const application = {
      id: `operator-${Date.now()}`,
      name: document.getElementById("operatorName").value.trim(),
      email: document.getElementById("operatorEmail").value.trim(),
      background: selectedValues("background"),
      tools: selectedValues("tools"),
      industries: selectedValues("industries"),
      exampleTasks: selectedValues("exampleTasks"),
      status: "Submitted",
      submittedAt: new Date().toISOString(),
    };
    saveListItem("skillnestOperatorApplications", application, "id");
    document.getElementById("operatorSuccess")?.classList.add("show");
    form.reset();
    form.querySelectorAll(".choice-pill").forEach((button) => {
      button.classList.remove("selected");
      button.setAttribute("aria-pressed", "false");
    });
  }

  function openTaskDetail(taskId) {
    const task = marketplaceTasks().find((item) => item.id === taskId);
    if (task) openModal(C.taskDetail(task));
  }

  function openOperatorProfile(operatorId) {
    const operator = operators.find((item) => item.id === operatorId);
    if (operator) openModal(C.operatorDetail(operator));
  }

  function openModal(markup) {
    let root = document.getElementById("modalRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "modalRoot";
      document.body.appendChild(root);
    }
    root.innerHTML = markup;
  }

  function closeModal() {
    const root = document.getElementById("modalRoot");
    if (root) root.innerHTML = "";
  }

  function showOperatorTab(event, tabName) {
    const panel = event.currentTarget.closest(".modal-panel");
    panel?.querySelectorAll(".operator-tabs .tab").forEach((tab) => tab.classList.remove("active"));
    event.currentTarget.classList.add("active");
    panel?.querySelectorAll("[data-tab-panel]").forEach((item) => {
      item.classList.toggle("show", item.dataset.tabPanel === tabName);
    });
  }

  function scrollAssistantToLatest() {
    if (currentRoute() !== "task-review") return;
    const thread = document.getElementById("assistantThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
    document.getElementById("assistantReply")?.scrollIntoView({ block: "nearest" });
  }

  function render() {
    const route = currentRoute();
    const account = getAccount();
    const files = readJson("skillnestDraftFiles", []);
    const draftTask = localStorage.getItem("skillnestDraftTask") || "";
    const generatedBrief = getGeneratedBrief();
    const page = route === "post-task"
      ? (isLoggedIn() ? Pages.postTaskPage(account, draftTask, generatedBrief) : Pages.authPage())
      : route === "auth"
        ? Pages.authPage()
      : route === "signup"
        ? Pages.signupPage()
      : route === "task-review"
        ? Pages.taskReviewPage(draftTask, files, generatedBrief, getAssistantMessages())
      : route === "operator"
        ? Pages.operatorPage(account)
      : route === "how-it-works"
        ? Pages.howItWorksPage()
      : route === "trust"
        ? Pages.trustPage()
      : route === "browse"
        ? Pages.browsePage(marketplaceTasks())
      : route === "profile"
        ? (isLoggedIn() ? Pages.profilePage(account, getPostedTasks(), getMissions(), getOperatorApplications()) : Pages.authPage())
      : Pages.homePage(draftTask, files);

    document.getElementById("app").innerHTML = `<div class="app-shell">${C.nav(route, isLoggedIn(), account)}${page}${C.footer(isLoggedIn())}</div>`;
    requestAnimationFrame(() => {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
      syncMissionCardStates();
      renderFilePreviews();
      scrollAssistantToLatest();
    });
  }

  window.addEventListener("hashchange", render);

  return {
    applyTaskFilters,
    answerClarification,
    clearTaskDraft,
    closeModal,
    completeLogin,
    completeReferenceFiles,
    completeSignup,
    confirmTaskReview,
    confirmSection,
    addCustomChoice,
    attachReferenceMaterial,
    cancelBriefEdit,
    deletePostedTask,
    editBriefField,
    editFinalSection,
    editSection,
    handleTaskFiles,
    handleAssistantReplyKey,
    logout,
    openOperatorProfile,
    openTaskDetail,
    pauseVoiceInput,
    quickTestLogin,
    removeMission,
    removeCustomChoice,
    removeDraftFile,
    render,
    saveMission,
    saveHatchDraft,
    setRoute,
    showOperatorTab,
    simulateVoiceInput,
    socialLogin,
    startTaskFlow,
    submitOperator,
    submitReviewedHatch,
    submitTask,
    sendAssistantReply,
    moveToNextSection,
    deleteVoiceTranscript,
    rewriteSection,
    stopVoiceInput,
    toggleChoice,
    toggleFinalEditList,
    toggleVoiceInput,
    updateDraftFileLabel,
    updateBriefField,
    updateLiveTaskPreview,
    updateSection,
    useExampleTask,
    useTaskChip,
  };
})();

SkillNestApp.render();
