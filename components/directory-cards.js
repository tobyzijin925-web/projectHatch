// Split out of components.js: task/operator/client cards, directory rows,
// match-scoring, sort helpers, and the verified-work feed. Depends on
// components/primitives.js (loaded earlier). `modal` is defined later in the
// still-monolithic trunk file, so the three functions here that need it
// (clientDetail, verifiedProjectDetail, verifiedOperatorProfile) look it up
// on window.SkillNestComponents at call time rather than destructuring it —
// by the time a user actually opens one of these, every script has finished
// loading, but destructuring eagerly at this file's own load time would
// capture undefined since the trunk hasn't run yet.
window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  const { operators, clients, completedHatches, operatorProfiles } = window.SkillNestData;
  const { escapeHtml, tag, userAvatar, statusBadge, statusInfo } = window.SkillNestComponents;

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
    return window.SkillNestComponents.modal(`
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
    return window.SkillNestComponents.modal(`
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
    return window.SkillNestComponents.modal(`
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

  return {
    budgetSortValue,
    completionSortValue,
    levelSortValue,
    formatRangeValue,
    rangeFilterMarkup,
    taskLanguageState,
    languageBadge,
    taskCard,
    operatorCard,
    operatorMatchScore,
    operatorLevelBucket,
    operatorDirectoryCard,
    recommendedOperators,
    clientMatchScore,
    clientDirectoryCard,
    clientCard,
    recommendedClients,
    clientDetail,
    verifiedWorkCard,
    recentVerifiedWorkSection,
    verifiedProjectDetail,
    verifiedOperatorProfile,
  };
})());
