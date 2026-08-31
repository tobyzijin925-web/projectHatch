// Split out of app.js: small localStorage helpers for the draft task/brief
// and Operator-recommendation context. Depends on app/backend-client.js
// (readJson, getPostedTasks), loaded just before this file. normalizeConfidence
// is still defined in the app.js trunk (part of the intake logic, not yet
// split out), so it's looked up on window.SkillNestApp at call time.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { readJson, getPostedTasks } = window.SkillNestApp;

  function trySetLocalStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function saveListItem(key, item, matchKey = "title") {
    const list = readJson(key, []);
    const index = list.findIndex((existing) => existing[matchKey] === item[matchKey]);
    if (index >= 0) list[index] = { ...list[index], ...item };
    else list.unshift(item);
    return trySetLocalStorage(key, list);
  }

  function saveDraftTask() {
    const prompt = document.getElementById("taskPrompt");
    if (prompt) localStorage.setItem("skillnestDraftTask", prompt.value.trim());
  }

  function getGeneratedBrief() {
    const brief = readJson("skillnestGeneratedBrief", null);
    // Defend every "confidence < 40 = invalid" check against a brief that was
    // stored on a 0-1 scale (older build, or a model reply mid-conversation):
    // normalize to 0-100 on read so a resumed conversation can't be misread as
    // invalid_input. Idempotent for values already on the 0-100 scale.
    if (brief && brief.confidence != null) {
      brief.confidence = window.SkillNestApp.normalizeConfidence(brief.confidence, brief.isValidProject ? 72 : 0);
    }
    return brief;
  }

  // What to personalize the Operator recommendations around: the industry of
  // whatever project the visitor is currently working on, falling back to
  // their most recently posted Hatch. Empty when neither exists — the
  // recommendation algorithm still ranks by quality, just without a match boost.
  function operatorRecommendationContext() {
    const brief = getGeneratedBrief();
    if (brief?.industry && brief.industry !== "General business") return { industry: brief.industry };
    const [latestPosted] = getPostedTasks();
    if (latestPosted?.industry) return { industry: latestPosted.industry };
    return {};
  }

  return {
    trySetLocalStorage,
    saveListItem,
    saveDraftTask,
    getGeneratedBrief,
    operatorRecommendationContext,
  };
})());
