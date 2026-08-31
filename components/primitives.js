// Split out of components.js: string/markup primitives with no dependency on
// app data (taskChips/operators/etc.) — safe to load first. Loaded as a plain
// classic script (not a module) so execution stays synchronous and in the
// same document order as every other script here; it contributes to the same
// window.SkillNestComponents object the rest of components.js builds on.
window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function tag(text, variant = "") {
    return `<span class="tag ${variant}">${escapeHtml(text)}</span>`;
  }

  // ── Avatars ──────────────────────────────────────────────────────────────
  // Every user gets a picture: their uploaded avatar when they set one, and a
  // deterministic initials-on-color circle otherwise. System messages from
  // Hatch itself use the hatchling mark so they read as platform, not person.

  const AVATAR_COLORS = ["#0d8e5b", "#7c3aed", "#b45309", "#0369a1", "#be185d", "#4d7c0f", "#b91c1c", "#475569"];

  function avatarColor(seed = "") {
    let hash = 0;
    const text = String(seed);
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  function avatarInitials(user = {}) {
    const source = String(user.name || user.username || "?").trim();
    const words = source.split(/\s+/).filter(Boolean);
    const initials = words.length >= 2 ? `${words[0][0]}${words[1][0]}` : source.slice(0, 2);
    return initials.toUpperCase();
  }

  function userAvatar(user = {}, className = "avatar-md") {
    if (user.avatar && String(user.avatar).startsWith("data:image/")) {
      return `<img class="user-avatar ${className}" src="${escapeHtml(user.avatar)}" alt="" />`;
    }
    const seed = user.username || user.email || user.name || "?";
    return `<span class="user-avatar initials-avatar ${className}" style="background:${avatarColor(seed)}" aria-hidden="true">${escapeHtml(avatarInitials(user))}</span>`;
  }

  function systemAvatar(className = "avatar-md") {
    return `<span class="user-avatar system-avatar ${className}" aria-hidden="true">🐣</span>`;
  }

  function statusInfo(status = "") {
    const normalized = {
      Open: "New Hatch",
      Submitted: "New Hatch",
      Accepted: "Incubating",
      "In progress": "Incubating",
      Completed: "Hatched",
    }[status] || status || "New Hatch";

    const icons = {
      "New Hatch": "🥚",
      Incubating: "🛠",
      "In review": "📮",
      Hatched: "🐣",
      Saved: "Saved",
    };

    return {
      label: normalized,
      icon: icons[normalized] || "",
      className: normalized.toLowerCase().replaceAll(" ", "-"),
    };
  }

  function statusBadge(status) {
    const info = statusInfo(status);
    return `<span class="status-pill hatch-status status-${info.className}">${info.icon ? `${info.icon} ` : ""}${escapeHtml(info.label)}</span>`;
  }

  function field(label, id, placeholder, type = "text", options = {}) {
    const value = options.value ? ` value="${escapeHtml(options.value)}"` : "";
    const readonly = options.readonly ? " readonly" : "";
    return `
      <label class="field">
        <span>${label}</span>
        <input id="${id}" type="${type}" placeholder="${placeholder}"${value}${readonly} required />
      </label>
    `;
  }

  function selectField(label, id, options, selected = "") {
    return `
      <label class="field">
        <span>${label}</span>
        <select id="${id}" required>
          <option value="">Select</option>
          ${options.map((option) => `<option${option === selected ? " selected" : ""}>${option}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function textAreaField(label, id, placeholder, value = "") {
    return `
      <label class="field full-field">
        <span>${label}</span>
        <textarea id="${id}" rows="5" placeholder="${placeholder}" required>${escapeHtml(value)}</textarea>
      </label>
    `;
  }

  function choiceField(label, name, options, otherPlaceholder, selected = []) {
    const customChoices = selected.filter((value) => !options.includes(value));
    return `
      <fieldset class="choice-field">
        <legend>${label}</legend>
        <div class="choice-options">
          ${options.map((option) => {
            const isSelected = selected.includes(option);
            return `
            <button class="choice-pill${isSelected ? " selected" : ""}" type="button" name="${name}" value="${escapeHtml(option)}" aria-pressed="${isSelected}" onclick="SkillNestApp.toggleChoice(event, this)">${option}</button>
          `;
          }).join("")}
          ${customChoices.map((value) => `
            <button class="choice-pill custom-choice selected" type="button" name="${name}" value="${escapeHtml(value)}" aria-pressed="true" onclick="SkillNestApp.toggleChoice(event, this)">${escapeHtml(value)} <span class="remove-choice" onclick="SkillNestApp.removeCustomChoice(event, this)">x</span></button>
          `).join("")}
        </div>
        <div class="choice-other-row">
          <input class="choice-other" name="${name}Other" type="text" placeholder="${otherPlaceholder}" />
          <button class="btn secondary small" type="button" onclick="SkillNestApp.addCustomChoice(event, '${name}')">Add</button>
        </div>
      </fieldset>
    `;
  }

  function sentenceTitle(text, fallback) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return fallback;
    const firstSentence = clean.split(/[.!?]/)[0].trim();
    return firstSentence.length > 76 ? `${firstSentence.slice(0, 73)}...` : firstSentence;
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

  function normalizeTaskText(text = "") {
    return String(text || "")
      .replace(/\bcafé\b/gi, "cafe")
      .replace(/\binstragram\b/gi, "instagram")
      .replace(/\binsta\b/gi, "instagram");
  }

  return {
    escapeHtml,
    tag,
    avatarInitials,
    userAvatar,
    systemAvatar,
    statusInfo,
    statusBadge,
    field,
    selectField,
    textAreaField,
    choiceField,
    sentenceTitle,
    cleanSentence,
    normalizeTaskText,
  };
})());
