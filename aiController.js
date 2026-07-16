window.HatchAIController = (() => {
  const STORAGE_STATE = "hatchAiControllerState";
  const STORAGE_ERROR = "hatchAiLastError";
  const STORAGE_MODE = "hatchAiIntakeMode";

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  function writeState(update = {}) {
    const current = readJson(STORAGE_STATE, {});
    const next = {
      conversationHistory: [],
      activeQuestion: "",
      activeSection: "project",
      expectedAnswerType: "project",
      briefState: {},
      readiness: "needs_context",
      canSubmit: false,
      lastAIResponse: null,
      lastRawResponse: "",
      lastResponseTimeMs: null,
      lastProvider: "",
      lastModel: "",
      lastIntent: "",
      lastUserMessage: "",
      lastAssistantSource: "",
      lastError: "",
      fallbackUsed: false,
      lastFieldsUpdated: [],
      missingInfoBefore: [],
      missingInfoAfter: [],
      lastNextQuestion: "",
      duplicateBlocked: false,
      activeTurn: null,
      ...current,
      ...update,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_STATE, JSON.stringify(next));
    return next;
  }

  function getState() {
    return readJson(STORAGE_STATE, writeState());
  }

  function markConnected() {
    localStorage.removeItem(STORAGE_ERROR);
    localStorage.setItem(STORAGE_MODE, "connected");
    writeState({ fallbackUsed: false, lastError: "" });
  }

  function markFallback(reason = "") {
    const message = `DeepSeek API failed. Local fallback is being used.${reason ? ` ${reason}` : ""}`;
    localStorage.setItem(STORAGE_ERROR, message);
    localStorage.setItem(STORAGE_MODE, "local-fallback");
    writeState({ fallbackUsed: true, lastError: message, lastAssistantSource: "local-fallback" });
    return message;
  }

  function apiUrl(endpoint = "") {
    const savedBase = localStorage.getItem("hatchApiBaseUrl");
    if (savedBase) return `${savedBase.replace(/\/$/, "")}${endpoint}`;

    const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    const isLocalPage = localHosts.has(window.location.hostname);
    if (isLocalPage && window.location.protocol !== "file:" && window.location.port) {
      return endpoint;
    }

    if (window.location.protocol === "file:") {
      return `http://127.0.0.1:8132${endpoint}`;
    }

    return endpoint;
  }

  function parseRawJson(rawText = "") {
    try {
      return JSON.parse(rawText || "{}");
    } catch (error) {
      const match = String(rawText || "").match(/\{[\s\S]*\}/);
      if (!match) throw error;
      return JSON.parse(match[0]);
    }
  }

  function responsePayload(data = {}) {
    return data.brief || data.result || data;
  }

  function hasUsableAIShape(payload = {}) {
    if (!payload || typeof payload !== "object") return false;
    return Boolean(
      "valid_input" in payload
      || "task_detected" in payload
      || "assistant_message" in payload
      || "brief_updates" in payload
      || "next_question" in payload
      || "readiness" in payload
      || "can_submit" in payload,
    );
  }

  function ensureValidAIResponse(data = {}) {
    if (!data.ok) throw new Error(data.error || "DeepSeek response was not ok.");
    const payload = responsePayload(data);
    if (!hasUsableAIShape(payload)) throw new Error("DeepSeek JSON did not match Hatch intake shape.");
    return payload;
  }

  function fallbackBriefFor(payload = {}, reason = "") {
    markFallback(reason);
    const text = payload.inputText || payload.answer || "";
    const files = payload.files || payload.brief?.files || [];
    const C = window.SkillNestComponents;

    if (payload.mode === "clarify" && payload.brief) {
      return {
        ...payload.brief,
        assistantMessage: "I’m having trouble reaching DeepSeek right now. I saved your note locally, but this is fallback mode.",
        nextQuestion: payload.brief.nextQuestion || { key: "general", prompt: "", suggestions: [], placeholder: "" },
      };
    }

    if (C?.isLowQualityProjectInput?.(text, files)) {
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
        summary: "",
        assistantMessage: "I’m not quite sure what you want done yet. Tell me the task, who it is for, and what result you want.",
        nextQuestion: {
          key: "project",
          prompt: "What do you want a Hatcher to help with?",
          suggestions: [],
          placeholder: "Describe the Hatch",
        },
        readiness: "Needs More Context",
        sourceText: text,
        files,
      };
    }

    return C?.generateTaskBrief?.(text, files) || {
      ok: false,
      error: "Local fallback unavailable.",
    };
  }

  async function send(endpoint, payload = {}) {
    const userInput = payload.inputText || payload.answer || "";
    const activeQuestion = payload.conversation_state?.active_question || payload.brief?.activeQuestion || "";
    const activeSection = payload.conversation_state?.active_section || payload.brief?.activeSection || "project";
    console.log("[Hatch AI] user message:", userInput);
    console.log("[Hatch AI] active question:", activeQuestion);
    console.log("[Hatch AI] active section:", activeSection);
    console.log("[Hatch AI] DeepSeek request started");
    const startedAt = performance.now();

    const controllerState = writeState({
      conversationHistory: payload.messages || payload.conversation_state?.conversation_history || [],
      activeQuestion,
      activeSection,
      expectedAnswerType: payload.conversation_state?.expected_answer_type || payload.key || "project",
      briefState: payload.brief || {},
      readiness: payload.brief?.readiness || "needs_context",
      canSubmit: payload.brief?.stage === "ready_to_post",
    });

    const requestBody = {
      ...payload,
      ai_controller_state: controllerState,
    };

    try {
      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      console.log("[Hatch AI] DeepSeek response status:", response.status);
      const rawText = await response.text();
      console.log("[Hatch AI] DeepSeek raw response:", rawText);
      console.log("[Hatch AI] raw response:", rawText);

      const parsed = parseRawJson(rawText);
      console.log("[Hatch AI] parsed response:", parsed);

      if (!response.ok) throw new Error(parsed.error || `DeepSeek request failed with ${response.status}.`);
      const aiPayload = ensureValidAIResponse(parsed);
      const responseTimeMs = Math.round(performance.now() - startedAt);

      markConnected();
      writeState({
        lastAIResponse: aiPayload,
        lastRawResponse: parsed.rawText || rawText,
        lastResponseTimeMs: parsed.responseTimeMs || responseTimeMs,
        lastProvider: parsed.provider || aiPayload.source || "deepseek",
        lastModel: parsed.model || "",
        lastIntent: aiPayload.intent || aiPayload.next_action || "",
        lastUserMessage: userInput,
        lastAssistantSource: aiPayload.source || parsed.provider || "deepseek",
        activeQuestion: aiPayload.next_question || aiPayload.nextQuestion || "",
        activeSection: aiPayload.active_section || controllerState.activeSection,
        expectedAnswerType: aiPayload.expected_answer_type || controllerState.expectedAnswerType,
        readiness: aiPayload.readiness || controllerState.readiness,
        canSubmit: aiPayload.can_submit === true,
      });
      console.log("[Hatch AI] fallback used:", false);
      return { ok: true, data: parsed, payload: aiPayload, fallbackUsed: false };
    } catch (error) {
      console.log("[Hatch AI] fallback used:", true);
      console.warn("[Hatch AI] fallback reason:", error.message);
      const fallback = fallbackBriefFor(payload, error.message);
      writeState({
        lastAIResponse: fallback,
        lastRawResponse: "",
        lastResponseTimeMs: Math.round(performance.now() - startedAt),
        lastProvider: "Local fallback",
        lastModel: "",
        lastIntent: "FALLBACK",
        lastUserMessage: userInput,
        lastAssistantSource: "local-fallback",
        activeQuestion: fallback.nextQuestion?.prompt || "",
        activeSection: fallback.activeSection || payload.conversation_state?.active_section || payload.brief?.activeSection || "project",
        expectedAnswerType: payload.conversation_state?.expected_answer_type || payload.key || "project",
        readiness: fallback.readiness || payload.brief?.readiness || "needs_context",
        canSubmit: fallback.stage === "ready_to_post",
      });
      return { ok: true, data: { ok: true, brief: fallback }, payload: fallback, fallbackUsed: true, error };
    }
  }

  async function organize(payload = {}) {
    return send("/api/project-intake", payload);
  }

  async function continueConversation(payload = {}) {
    return send("/api/project-assistant", payload);
  }

  async function testDeepSeekConnection() {
    const status = await fetch(apiUrl("/api/ai-status")).then((response) => response.json());
    console.log("[Hatch AI] DeepSeek request started");
    const result = await send("/api/project-intake", {
      mode: "organize",
      inputText: "Create a LinkedIn post for my café announcing a new summer drink.",
      files: [],
      messages: [],
    });
    const summary = {
      provider: status.provider,
      model: status.model,
      keyConfigured: status.keyConfigured,
      fallbackUsed: result.fallbackUsed,
      parsed: result.payload,
    };
    console.log("[Hatch AI] test parsed response:", summary);
    return summary;
  }

  async function refreshStatus() {
    try {
      const status = await fetch(apiUrl("/api/ai-status")).then((response) => response.json());
      if (status?.ok && status.keyConfigured) {
        const previousMode = localStorage.getItem(STORAGE_MODE);
        const previousError = localStorage.getItem(STORAGE_ERROR);
        markConnected();
        // The page renders before this ping resolves, so clearing a stale error
        // is invisible until something repaints. Only repaint when the banner
        // would actually change, to avoid clobbering in-progress typing.
        if (previousMode !== "connected" || previousError) window.SkillNestApp?.render?.();
      }
      return status;
    } catch {
      return null;
    }
  }

  window.setTimeout(refreshStatus, 250);

  return {
    getState,
    writeState,
    organize,
    continueConversation,
    refreshStatus,
    testDeepSeekConnection,
  };
})();
