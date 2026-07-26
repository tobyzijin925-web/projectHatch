window.SkillNestComponents = (() => {
  const { taskChips, operators, clients, hatchedWork, completedHatches, hatcherProfiles } = window.SkillNestData;

  // The assistant's display name in the chat UI. Change this one value to
  // rename it everywhere it appears to users. (The matching name inside the AI
  // instructions is ASSISTANT_NAME in server.js — update both to keep them in
  // sync.)
  const ASSISTANT_LABEL = "Chickie";

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

  function hatcherForWork(work) {
    return hatcherProfiles.find((profile) => profile.id === work.hatcherId);
  }

  function visibleHatcherName(work) {
    const profile = hatcherForWork(work);
    if (!work.showProfile) return "Private Hatcher";
    // Published results (from a real client review) carry a plain hatcherName
    // instead of a seeded hatcherProfiles entry, so fall back to that.
    return profile?.name || work.hatcherName || "Private Hatcher";
  }

  function visibleEarnings(work) {
    return work.showEarnings ? work.amountEarned : "Earnings hidden";
  }

  function visibleCompletionTime(work) {
    return work.showCompletionTime ? work.completionTime : "Completion time hidden";
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

  function isLowQualityProjectInput(inputText = "", files = []) {
    const clean = normalizeTaskText(inputText).toLowerCase().replace(/[^\w\s$-]/g, " ").replace(/\s+/g, " ").trim();
    if (files.length && clean.length >= 6) return false;
    if (!clean) return true;

    const words = clean.split(" ").filter(Boolean);
    const uniqueWords = new Set(words);
    const greetings = new Set(["hi", "hello", "hey", "yo"]);
    const vaguePhrases = ["i need help", "need help", "help me", "can you help", "please help"];
    const taskSignals = [
      "build", "create", "design", "write", "rewrite", "organize", "automate", "setup", "set up",
      "make", "fix", "update", "content", "website", "menu", "post", "posts", "social", "caption",
      "captions", "instagram", "product", "descriptions", "customer", "reply", "template", "spreadsheet",
      "data", "chatbot", "workflow", "linkedin", "newsletter", "deck", "pitch", "presentation", "proposal",
      "email", "cold email", "hiring", "blog", "flyer", "research", "competitor", "competitors", "resume",
      "notion", "feedback", "summarize", "summary", "calendar", "plan", "business plan", "sop",
    ];
    const contextSignals = ["cafe", "restaurant", "salon", "store", "shop", "business", "client", "customer", "product", "menu"];
    const hasTaskSignal = taskSignals.some((signal) => clean.includes(signal));

    if (clean.length < 12 && !hasTaskSignal) return true;
    if (words.length >= 4 && hasTaskSignal && contextSignals.some((signal) => clean.includes(signal))) return false;
    if (words.length <= 3 && !hasTaskSignal) return true;
    if (words.every((word) => greetings.has(word))) return true;
    if (vaguePhrases.includes(clean)) return true;
    if (words.length >= 3 && uniqueWords.size <= 2) return true;
    if (/^(.)\1{5,}$/.test(clean.replace(/\s/g, ""))) return true;
    if (!/[aeiou]/.test(clean) && clean.length > 8) return true;
    if (/^[a-z]{8,}$/.test(clean) && uniqueWords.size === 1 && !hasTaskSignal) return true;

    return !hasTaskSignal && words.length < 6;
  }

  function detectIndustry(lower) {
    if (lower.includes("cafe") || lower.includes("restaurant") || lower.includes("menu")) return "Restaurant";
    if (lower.includes("product") || lower.includes("shopify") || lower.includes("store") || lower.includes("ecommerce")) return "E-commerce";
    if (lower.includes("website") || lower.includes("salon") || lower.includes("booking") || lower.includes("barber")) return "Local Services";
    if (lower.includes("real estate") || lower.includes("property") || lower.includes("lead")) return "Real Estate";
    if (lower.includes("tutor") || lower.includes("school") || lower.includes("course")) return "Education";
    return "General business";
  }

  function detectCategory(lower) {
    if (lower.includes("website") || lower.includes("landing page")) return "Website";
    if (lower.includes("caption") || lower.includes("instagram") || lower.includes("linkedin") || lower.includes("newsletter") || lower.includes("blog") || lower.includes("content") || lower.includes("reel")) return "Content";
    if (lower.includes("deck") || lower.includes("presentation") || lower.includes("proposal")) return "Presentation";
    if (lower.includes("business plan") || lower.includes("sop")) return "Writing";
    if (lower.includes("research") || lower.includes("competitor")) return "Research";
    if (lower.includes("email") || lower.includes("resume") || lower.includes("hiring post")) return "Writing";
    if (lower.includes("chatbot") || lower.includes("reply") || lower.includes("faq")) return "Customer Support";
    if (lower.includes("automate") || lower.includes("workflow") || lower.includes("sheet") || lower.includes("spreadsheet") || lower.includes("notion") || lower.includes("invoice")) return "Operations";
    if (lower.includes("menu") || lower.includes("flyer") || lower.includes("canva") || lower.includes("design")) return "Design";
    return "General";
  }

  function suggestedLevel(lower) {
    if (lower.includes("strategy") || lower.includes("full system") || lower.includes("complex")) return "L4";
    if (lower.includes("automate") || lower.includes("workflow") || lower.includes("chatbot") || lower.includes("zapier")) return "L3";
    if (lower.includes("website") || lower.includes("menu") || lower.includes("calendar") || lower.includes("template") || lower.includes("deck") || lower.includes("presentation") || lower.includes("research")) return "L2";
    return "L1";
  }

  function levelBudget(level) {
    return {
      L1: "$50 - $150",
      L2: "$150 - $500",
      L3: "$500 - $1,500",
      L4: "$1,500+",
    }[level] || "$150 - $500";
  }

  function levelTimeline(level) {
    return {
      L1: "1-3 days",
      L2: "3-7 days",
      L3: "1-2 weeks",
      L4: "2-4 weeks",
    }[level] || "3-7 days";
  }

  function detectBudget(lower) {
    const moneyMatch = lower.match(/\$[\d,]+(?:\s*-\s*\$?[\d,]+)?|\bunder\s*\$?\d+|\b\d+\s*(?:dollars|usd)\b/i);
    if (moneyMatch) return moneyMatch[0];
    if (lower.includes("cheap") || lower.includes("small budget")) return "Under $100";
    if (lower.includes("flexible budget")) return "Flexible";
    return "";
  }

  function detectTimeline(lower) {
    if (lower.includes("this week") || lower.includes("urgent") || lower.includes("asap")) return "This week";
    if (lower.includes("this month")) return "This month";
    if (lower.includes("next week")) return "Next week";
    if (lower.includes("flexible")) return "Flexible";
    const dayMatch = lower.match(/\b\d+\s*(?:day|days|week|weeks|month|months)\b/i);
    return dayMatch ? dayMatch[0] : "";
  }

  function detectReferences(lower, files = []) {
    const references = [];
    if (lower.includes("example") || lower.includes("reference") || lower.includes("inspiration")) references.push("Examples mentioned in description");
    files.forEach((file) => references.push(file.name || file));
    return references;
  }

  function suggestedTitle(cleanText, industry, category) {
    const lower = cleanText.toLowerCase();
    if (lower.includes("linkedin")) return sentenceTitle(cleanText, "Write a LinkedIn post");
    if (lower.includes("instagram")) return sentenceTitle(cleanText, "Create Instagram content");
    if (lower.includes("pitch deck")) return sentenceTitle(cleanText, "Create a pitch deck");
    if (lower.includes("presentation")) return sentenceTitle(cleanText, "Prepare a presentation");
    if (lower.includes("newsletter")) return sentenceTitle(cleanText, "Write a newsletter");
    if (lower.includes("cold email")) return sentenceTitle(cleanText, "Draft a cold email");
    if (lower.includes("proposal")) return sentenceTitle(cleanText, "Write a client proposal");
    if (lower.includes("business plan")) return sentenceTitle(cleanText, "Draft a business plan");
    if (lower.includes("research") || lower.includes("competitor")) return sentenceTitle(cleanText, "Research competitors");
    if (lower.includes("spreadsheet") || lower.includes("sheet")) return sentenceTitle(cleanText, "Organize a spreadsheet");
    if (category === "Content" && lower.includes("instagram") && (lower.includes("cafe") || lower.includes("restaurant"))) return "Instagram content for a cafe";
    if (industry !== "General business" && category !== "General") return `${industry} ${category}`.trim();
    if (category !== "General") return category;
    return sentenceTitle(cleanText, "New task");
  }

  function suggestedObjective(cleanText, industry, category) {
    const lower = cleanText.toLowerCase();
    if (category === "Content" && lower.includes("instagram") && (lower.includes("cafe") || lower.includes("restaurant"))) {
      return "Create Instagram content from the cafe’s menu so the business can post consistently and attract local customers.";
    }
    if (category === "Website") {
      if (lower.includes("salon")) return "Build a simple salon website that explains services, pricing, contact details, and booking clearly.";
      if (lower.includes("nail")) return "Build a simple nail salon website that shows services, prices, examples, and booking information.";
      if (industry === "Local Services") return "Build a simple local services website that explains the offer, builds trust, and helps customers make an enquiry or booking.";
      return "Build a clear one-page website that explains the offer and gives visitors an obvious next step.";
    }
    if (category === "Customer Support") return "Create useful customer reply material so common questions can be answered faster and more consistently.";
    if (category === "Operations") return "Organize the current workflow into a simpler process that saves time and reduces repeated admin work.";
    if (category === "Presentation") return "Create a clear presentation that explains the idea, message, or proposal in a polished structure.";
    if (category === "Research") return "Research the topic and organize the findings into clear, useful notes the client can act on.";
    if (category === "Writing") return "Write polished copy that fits the intended audience, purpose, and tone.";
    if (category === "Content") return "Create usable content that communicates the message clearly and gives the audience an obvious next step.";
    if (category === "Design" && industry === "Restaurant") return "Create a clean restaurant menu that makes items, prices, and specials easy for customers to understand.";
    if (category === "Design") return "Create a clean, usable design asset that is ready for the business to edit or publish.";
    if (industry === "E-commerce") return "Improve product content so customers can understand, compare, and buy items more easily.";
    if (industry !== "General business") return `Turn the ${industry.toLowerCase()} request into a clear, usable result for the client.`;
    return cleanSentence(cleanText).replace(/\.$/, "") || "Create a clear, usable result for the client.";
  }

  function fallbackScope(cleanText, category) {
    const lower = cleanText.toLowerCase();
    if (lower.includes("linkedin")) return ["Understand the announcement topic", "Draft one polished LinkedIn post", "Suggest two opening hooks", "Include a clear call to action", "Match the intended tone"];
    if (lower.includes("instagram")) return ["Clarify the content goal", "Create post ideas or captions", "Organize content into a usable format", "Suggest simple CTA or hashtag notes"];
    if (category === "Presentation") return ["Clarify the audience and purpose", "Create a slide-by-slide structure", "Draft key talking points", "Suggest stronger section headings"];
    if (category === "Research") return ["Define the research questions", "Collect relevant findings", "Summarize patterns", "Organize insights into clear notes"];
    if (category === "Operations") return ["Review the current process or data", "Organize the information into clear sections", "Clean up inconsistencies", "Prepare simple handoff notes"];
    if (category === "Website") return ["Structure the page", "Write clear page copy", "Create calls to action", "Organize service or offer sections"];
    if (category === "Design") return ["Clarify the required format", "Organize the content", "Improve readability", "Prepare editable design notes"];
    return ["Clarify the intended audience", "Create the first polished version", "Organize the work into a usable format", "Prepare concise handoff notes"];
  }

  function fallbackDeliverables(cleanText, category) {
    const lower = cleanText.toLowerCase();
    if (lower.includes("linkedin")) return ["One final LinkedIn post", "Two optional opening hooks", "Suggested call to action", "Optional hashtags"];
    if (lower.includes("instagram")) return ["Instagram post ideas or captions", "Suggested content angles", "CTA or hashtag notes"];
    if (category === "Presentation") return ["Presentation outline", "Slide-by-slide structure", "Key talking points", "Suggested title and section headings"];
    if (category === "Research") return ["Research summary", "Key findings", "Competitor or source notes", "Recommended next steps"];
    if (category === "Operations") return ["Organized spreadsheet or workflow notes", "Cleaned structure", "Duplicate or issue notes", "Update instructions"];
    if (category === "Website") return ["Homepage copy", "Page section structure", "CTA copy", "Mobile-friendly layout notes"];
    if (category === "Design") return ["Editable design copy or layout notes", "Organized sections", "Final handoff notes"];
    return ["Polished first version", "Structured handoff notes", "Optional revisions list"];
  }

  function generateTaskBrief(inputText, files = []) {
    const cleanText = normalizeTaskText(inputText).replace(/\s+/g, " ").trim();
    if (isLowQualityProjectInput(cleanText, files)) {
      return {
        ok: false,
        stage: "invalid_input",
        isValidProject: false,
        confidence: 10,
        error: "Tell me what you need done, who it is for, and what a good result would look like.",
      };
    }

    const lower = cleanText.toLowerCase();
    const industry = detectIndustry(lower);
    const category = detectCategory(lower);
    const level = suggestedLevel(lower);
    const title = suggestedTitle(cleanText, industry, category);
    const budget = detectBudget(lower);
    const timeline = detectTimeline(lower);
    const references = detectReferences(lower, files);
    const isInstagramCafe = category === "Content" && lower.includes("instagram") && (lower.includes("cafe") || lower.includes("restaurant"));

    const deliverables = isInstagramCafe
      ? ["Instagram post ideas", "Captions or copy", "Simple posting plan"]
      : fallbackDeliverables(cleanText, category);

    if (files.length) deliverables.push("Review attached reference files");

    return {
      ok: true,
      stage: "clarifying_missing_info",
      isValidProject: true,
      confidence: 55,
      title,
      businessType: industry === "General business" ? "To be confirmed" : industry,
      industry,
      category,
      suggestedLevel: level,
      suggestedBudget: budget || levelBudget(level),
      suggestedTimeline: timeline || levelTimeline(level),
      budgetKnown: Boolean(budget),
      timelineKnown: Boolean(timeline),
      deliverables,
      scope: fallbackScope(cleanText, category),
      knownRequirements: [
        cleanText,
        files.length ? "Attached files should be reviewed before work begins." : "",
      ].filter(Boolean),
      constraints: [
        lower.includes("brand") ? "Use existing brand direction." : "",
        lower.includes("simple") ? "Keep the solution simple and easy to use." : "",
      ].filter(Boolean),
      references,
      nextQuestion: {
        key: !timeline ? "timeline" : !budget ? "budget" : "references",
        prompt: !timeline
          ? "When would you like this finished?"
          : !budget
            ? "What budget range feels comfortable?"
            : "Do you have any examples or references to follow?",
        suggestions: !timeline ? ["This week", "This month", "Flexible"] : !budget ? ["Under $100", "$100-300", "$300-700", "Flexible"] : ["No references yet"],
        placeholder: !timeline ? "Type a timeline" : !budget ? "Type a budget" : "Add a reference",
      },
      questions: [
        "When would you like this completed?",
        "What budget range are you comfortable with?",
        "Do you already have examples or references to follow?",
      ],
      missingInfo: [
        industry === "General business" ? "industry" : "",
        !budget ? "budget" : "",
        !timeline ? "timeline" : "",
        !references.length ? "references" : "",
      ].filter(Boolean),
      recommendedHatcherType: level === "L3" || level === "L4" ? `${level} specialist Hatcher` : `${level} practical Hatcher`,
      summary: suggestedObjective(cleanText, industry, category),
      sourceText: cleanText,
      files,
      clarificationCount: 0,
    };
  }

  function projectReadiness(brief) {
    if (brief?.isProcessing) return "Understanding Your Project";
    if (brief?.stage === "invalid_input" || brief?.isValidProject === false || Number(brief?.confidence || 0) < 40) return "Needs More Context";
    if (brief?.stage === "ready_to_post") return "Ready to Post";
    if (brief?.readiness === "shaping") return "Shaping the Hatch";
    const allowed = ["Needs More Context", "Understanding Your Project", "Shaping the Hatch", "Almost Ready", "Ready to Post"];
    if (allowed.includes(brief?.readiness)) return brief.readiness;
    const missing = brief?.missingInfo?.length || 0;
    if (!brief?.ok) return "Needs More Context";
    if (missing >= 3) return "Needs More Context";
    if (missing === 2) return "Understanding Your Project";
    if (missing === 1) return "Almost Ready";
    return "Ready to Post";
  }

  function isProjectReady(brief) {
    return projectReadiness(brief) === "Ready to Post";
  }

  function understandingStatement(brief) {
    if (!brief?.ok) return "Tell me what you need done, who it is for, and what a good result would look like.";
    if (brief.category === "Content") return `It sounds like your goal is to create usable content for ${brief.industry === "General business" ? "your project" : `a ${brief.industry.toLowerCase()} business`}, not just collect random ideas.`;
    if (brief.category === "Website") return "It sounds like you need a clear web presence that explains the offer and helps people take action.";
    if (brief.category === "Operations") return "It sounds like you want to reduce manual work and make the process easier to repeat.";
    if (brief.category === "Customer Support") return "It sounds like you want clearer customer responses so common questions are handled consistently.";
    return "It sounds like you have a practical project that needs to be shaped into clear work a Hatcher can execute.";
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
        reason: "The Hatcher needs the actual food details so the work is accurate, not generic.",
        prompt: "Can you provide a menu photo/link, item list with prices, or examples of your current style?",
        suggestions: ["I can attach a menu", "I can paste food items", "No menu yet", "Use best judgment"],
        placeholder: "Paste menu items, prices, links, or notes",
      };
    }
    if (text.includes("website") || text.includes("salon") || text.includes("booking")) {
      return {
        key: "references",
        reason: "The Hatcher needs the real services, prices, photos, and booking details.",
        prompt: "What source material can you provide for the website?",
        suggestions: ["Services and prices", "Photos/logo", "Existing website", "No materials yet"],
        placeholder: "Paste services, prices, links, or notes",
      };
    }
    if (text.includes("product") || text.includes("shopify") || text.includes("e-commerce") || text.includes("ecommerce")) {
      return {
        key: "references",
        reason: "The Hatcher needs product details to avoid guessing.",
        prompt: "Can you share product names, current descriptions, photos, or a store link?",
        suggestions: ["Product list", "Store link", "Current descriptions", "No materials yet"],
        placeholder: "Paste product details, links, or notes",
      };
    }
    if (text.includes("faq") || text.includes("chatbot") || text.includes("support") || text.includes("reply")) {
      return {
        key: "references",
        reason: "The Hatcher needs real customer questions and policies to write useful replies.",
        prompt: "Can you share your FAQ, policies, common questions, or tone examples?",
        suggestions: ["FAQ/policies", "Common questions", "Tone examples", "No materials yet"],
        placeholder: "Paste FAQ, policies, questions, or notes",
      };
    }
    return {
      key: "references",
      reason: "Source material helps the Hatcher work from real context instead of guessing.",
      prompt: "What source material should the Hatcher use?",
      suggestions: ["I have files", "I have links", "No materials yet"],
      placeholder: "Paste a link, note, or source material",
    };
  }

  function nextClarification(brief) {
    if (!brief?.ok || brief.isProcessing || isProjectReady(brief) || (brief.clarificationCount || 0) >= 5) return null;
    if (brief.stage === "invalid_input" || brief.isValidProject === false || Number(brief.confidence || 0) < 40) {
      return {
        key: "objective",
        reason: "",
        prompt: "What are you trying to accomplish?",
        suggestions: ["Create social posts", "Build a simple website", "Organize customer data"],
        placeholder: "Describe the project in your own words",
      };
    }
    if (brief.nextQuestion?.key && brief.nextQuestion.key !== "none" && brief.nextQuestion.prompt) {
      return {
        key: brief.nextQuestion.key,
        reason: brief.nextQuestion.reason || "",
        prompt: brief.nextQuestion.prompt,
        suggestions: Array.isArray(brief.nextQuestion.suggestions) ? brief.nextQuestion.suggestions.filter(Boolean) : [],
        placeholder: brief.nextQuestion.placeholder || "Type your answer",
      };
    }
    const missing = brief.missingInfo || [];
    if (missing.includes("timeline")) {
      return {
        key: "timeline",
        reason: "Timing changes who we should match you with and how tightly the work should be scoped.",
        prompt: "When would you like this completed?",
        suggestions: ["This week", "This month", "Flexible"],
        placeholder: "Custom deadline",
      };
    }
    if (missing.includes("budget")) {
      return {
        key: "budget",
        reason: "Budget helps keep the project realistic before Hatchers apply.",
        prompt: "What budget range are you comfortable with?",
        suggestions: ["Under $100", "$100-300", "$300-1000", "Flexible"],
        placeholder: "Custom budget",
      };
    }
    if (missing.includes("industry")) {
      return {
        key: "industry",
        reason: "The business context changes the examples, tools, and Hatcher experience that matter.",
        prompt: "What type of business or project is this for?",
        suggestions: ["Restaurant", "Retail", "Professional Services", "Education", "Other"],
        placeholder: "Type of business",
      };
    }
    if (missing.includes("references")) {
      return referenceQuestionForBrief(brief);
    }
    return null;
  }

  function fallbackAssistantMessage(brief) {
    if (brief?.isProcessing) return "I’m reading through your project...";
    if (brief?.stage === "invalid_input" || brief?.isValidProject === false || Number(brief?.confidence || 0) < 40) {
      return "Tell me what you need done, who it is for, and what a good result would look like.";
    }
    const question = nextClarification(brief);
    if (!question) {
      return "I think this captures what you mean. You can post it when you’re ready.";
    }
    const understanding = brief.understanding || understandingStatement(brief);
    const reason = question.reason ? ` ${question.reason}` : "";
    return `${understanding}${reason} ${question.prompt}`;
  }

  function buildTaskBrief(rawText) {
    const brief = generateTaskBrief(rawText, []);
    if (!brief.ok) {
      return {
        title: rawText || "New task",
        outcome: "Add more detail to build a stronger Hatch brief.",
        scope: ["Clarify the expected result."],
        detailsNeeded: ["More detail"],
        industry: "General business",
        likelyLevel: "L1",
      };
    }

    return {
      title: brief.title,
      outcome: brief.summary,
      scope: brief.deliverables,
      detailsNeeded: brief.questions,
      industry: brief.industry,
      likelyLevel: brief.suggestedLevel,
    };
  }

  function taskBriefPreviewMarkup(brief) {
    if (!brief?.ok) return "";
    return `
      <div class="preview-head">
        <span class="tag level">${brief.suggestedLevel}</span>
        <span class="tag">${brief.industry}</span>
        <span class="tag">${brief.category}</span>
      </div>
      <strong>${escapeHtml(brief.title)}</strong>
      <p>${escapeHtml(brief.summary)}</p>
      <small>${escapeHtml(brief.suggestedBudget)} · ${escapeHtml(brief.suggestedTimeline)}</small>
    `;
  }

  const builderSections = [
    { id: "title", label: "I understand what you need", short: "Need is understood", prompt: "Here’s how I’d write this.", optional: false },
    { id: "businessType", label: "I know who it is for", short: "Who it is for", prompt: "I think this is who the work is for.", optional: false },
    { id: "summary", label: "I understand the outcome", short: "Outcome is clear", prompt: "Here’s how I’d summarize the goal.", multiline: true, optional: false },
    { id: "deliverables", label: "I know what should be delivered", short: "Outputs are clear", prompt: "Here’s what I think the Hatcher should create.", multiline: true, list: true, optional: false },
    { id: "suggestedTimeline", label: "Timeline is clear", short: "Timeline is clear", prompt: "Here’s the timeline I’d use for now.", optional: false },
    { id: "suggestedBudget", label: "Budget is clear", short: "Budget is clear", prompt: "Here’s the budget range I’d suggest.", optional: false },
    { id: "industry", label: "Context is clear", short: "Context is clear", prompt: "Here’s the category I’d use for matching.", optional: false },
    { id: "references", label: "Source material is clear", short: "Source material", prompt: "Here’s what I found for references or files.", multiline: true, list: true, optional: true },
    { id: "constraints", label: "Ready for a Hatcher", short: "Ready for Hatcher", prompt: "Here’s what I’d note so the work stays on track.", multiline: true, list: true, optional: true },
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
          <p>${needsDetail ? "One or two details could make this clearer." : "The brief has enough shape for a Hatcher to understand it."}</p>
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

  function localHatcherQuestions(brief = {}, files = []) {
    const questions = [];
    if (!brief.audience) questions.push("Who is the main audience?");
    if (!Array.isArray(brief.references) || !brief.references.length) questions.push("Do you have brand examples or source material?");
    if (!files.length && (!brief.references || !brief.references.length)) questions.push("Should the Hatcher use any files, photos, menus, or links?");
    if (!Array.isArray(brief.constraints) || !brief.constraints.length) questions.push("Should the tone be formal, friendly, or something else?");
    if (!brief.suggestedTimeline || /flexible/i.test(brief.suggestedTimeline)) questions.push("Is the timeline flexible?");
    if (!questions.length) questions.push("Should the final version be editable?", "Are there any details the Hatcher should avoid?");
    return questions.slice(0, 4);
  }

  function hatcherQuestionsCard(brief = {}, files = []) {
    const questions = Array.isArray(brief.hatcherQuestions) && brief.hatcherQuestions.length
      ? brief.hatcherQuestions.slice(0, 4)
      : localHatcherQuestions(brief, files);
    return `
      <div class="compact-insight-card hatcher-questions-card">
        <div class="insight-card-head">
          <h3>A Hatcher might still ask…</h3>
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
      deliverables: withValue ? "I’ve started listing the deliverables. What should the Hatcher definitely hand over?" : "What should the Hatcher deliver?",
      suggestedTimeline: withValue ? "I’ve put a timeline in the brief. Should we keep it, or make it flexible?" : "When would you ideally like this finished?",
      suggestedBudget: withValue ? "I’ve added a budget direction. Should we keep that, or leave it flexible?" : "What budget range feels comfortable?",
      industry: withValue ? "I’ve matched this to an industry. Does that category fit?" : "What industry or category does this belong to?",
      references: "Do you have examples, files, or links the Hatcher should follow?",
      constraints: "Anything the Hatcher should avoid or keep in mind?",
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
      ["Recommended Hatcher level", brief.recommendedHatcherType || brief.suggestedLevel || "L1"],
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
        ${hatcherQuestionsCard(brief, files)}
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
          <strong>${isFinal ? "Ready for a Hatcher" : escapeHtml(builderSections[activeIndex].label)}</strong>
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
          <p>Your project brief has enough detail for Hatchers to understand the work.</p>
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
    // Hide the fallback greeting while thinking with an empty thread, so the
    // very first response shows just the thinking bubble, then types in.
    const threadMessages = messages.length ? messages : (thinking ? [] : shownMessages);

    return `
      <section class="assistant-panel">
        ${aiError ? `<div class="assistant-dev-warning">${escapeHtml(aiError)}</div>` : ""}
        ${aiDebugPanelMarkup(debugState)}
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
            ${ready ? `<p class="review-ready-note">${escapeHtml(ASSISTANT_LABEL)} thinks this Hatch is ready. Look it over, then post it for Hatchers.</p>` : ""}
            <button class="btn primary full review-post-cta" type="button" ${ready ? "" : "disabled"} onclick="SkillNestApp.openHatchReview()">Review and Post</button>
          </div>
          <p class="assistant-input-hint">Type freely — Hatch will organize it.</p>
          <p class="inline-error" id="assistantInputError">Type a message before sending.</p>
        `}
      </section>
    `;
  }

  // Small "+" trigger next to the reply box. Opens upward (native <details>,
  // no JS needed to toggle) with generic upload categories so a Hatcher can
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
    const model = state.lastModel || "deepseek-chat";
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

  // The account dropdown behind the nav avatar (YouTube-style): identity at
  // the top, then the account destinations, then sign out. Rendered closed on
  // every page build; SkillNestApp.toggleProfileMenu() shows/hides it in
  // place, and document-level click/Escape handlers close it.
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

  // "Hatches" and "Hatchers" collapsed into one "Browse" trigger with a
  // dropdown, so the top nav doesn't run out of room as more destinations get
  // added — the same crowding problem the "About Hatch" merge solved earlier.
  function browseNavDropdown(active) {
    const options = [
      ["browse", "#browse", "Hatches"],
      ["hatchers", "#hatchers", "Hatchers"],
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
      `🐣 <strong>${nf(stats.activeHatchers)}</strong> active Hatchers`,
      `📋 <strong>${nf(stats.openHatches)}</strong> open Hatches`,
      `🔍 <strong>${nf(stats.activeClients)}</strong> clients looking for Hatchers`,
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

    // Existing Hatchers (signed in with a Hatcher/Operator role) already reach
    // the levels/ranking guide through "About Hatch" below, so they don't need
    // a second, differently-labeled link to the same page — only non-Hatchers
    // get the distinct "apply" call to action.
    const isHatcher = isLoggedIn && /hatcher|operator/i.test(String(account.role || ""));
    const hatcherLink = isHatcher
      ? ""
      : `<a href="#operator" class="${active === "operator" ? "active" : ""}">Become a Hatcher</a>`;

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
                ${hatcherLink}
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
      ["💬", "Direct threads", "Message any Hatcher before or during a Hatch — no gig-site inbox, no waiting on a bid."],
      ["📎", "Tied to the work", "Tag a thread to its Hatch so context and files stay attached to the project instead of scattered across email."],
      ["🔔", "Nothing missed", "Unread counts, automatic updates, and archiving keep active conversations easy to find."],
    ];
    return `
      <section class="section messaging-section">
        <div class="section-head centered-head">
          <div>
            <div class="section-label">Messaging</div>
            <h2>Talk directly. No middleman.</h2>
            <p class="section-kicker">Clients and Hatchers message each other straight through Hatch — ask a question, share a file, or check on progress, without leaving the platform.</p>
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
          <button class="btn primary" type="button" onclick="SkillNestApp.setRoute('hatchers')">Browse Hatchers</button>
          <button class="btn secondary" type="button" onclick="SkillNestApp.setRoute('messages')">Open Messages</button>
        </div>
      </section>
    `;
  }

  function whyHatchSection() {
    const rows = [
      ["Describing the work", "Write the perfect brief yourself, or get ignored", "Just talk naturally — AI turns it into a complete brief"],
      ["Finding the right person", "Scroll hundreds of near-identical gigs and reviews", "Matched to a verified Hatcher who fits the project"],
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
            <p>No more guessing what to write in a job post. Describe your problem in plain words, and AI shapes it into a brief a verified Hatcher can act on immediately — real help, faster than any gig site.</p>
          </article>
        </div>
      </section>
    `;
  }

  function hatchLifecycleSection() {
    const stages = [
      ["Stage 1", "🥚", "New Hatch", "Business owners post a real business problem they would like AI to solve."],
      ["Stage 2", "🛠", "Incubating", "A verified Hatcher develops and refines the solution."],
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
  // ones. Response time and days-since-active reward Hatchers who are
  // actually around and quick to reply right now, not just historically good.
  // An optional context (industry/tools the browsing client cares about)
  // adds a match boost on top of that baseline quality score.
  const HATCHER_SCORE_WEIGHTS = {
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

  function hatcherMatchScore(operator, context = {}) {
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
      HATCHER_SCORE_WEIGHTS.rating * rating +
      HATCHER_SCORE_WEIGHTS.onTime * onTime +
      HATCHER_SCORE_WEIGHTS.completed * completed +
      HATCHER_SCORE_WEIGHTS.responseTime * responseTime +
      HATCHER_SCORE_WEIGHTS.repeatClients * repeatClients +
      HATCHER_SCORE_WEIGHTS.recency * recency
    );

    const industryMatch = context.industry && (operator.industries || []).includes(context.industry) ? 15 : 0;
    const toolOverlap = context.tools?.length
      ? (operator.tools || []).filter((tool) => context.tools.includes(tool)).length
      : 0;
    const toolMatch = Math.min(10, toolOverlap * 4);

    return Math.round(clamp01((baseScore + industryMatch + toolMatch) / 100) * 100);
  }

  // "L2 Hatcher" / "L3 Specialist" -> "L2" / "L3", for level-filter checkboxes.
  function hatcherLevelBucket(level = "") {
    const match = String(level).match(/L\d/);
    return match ? match[0] : level;
  }

  // Directory row: profile image on the left, details on the right — the
  // Hatcher counterpart to a browse task-card, but laid out two per row
  // instead of a card grid, since a person reads more naturally as a wide row
  // than a tall tile. Clicking anywhere opens the full profile; the message
  // button is a direct line that doesn't require opening it first.
  function hatcherDirectoryCard(operator, context = {}) {
    const searchable = `${operator.name} ${operator.bio} ${operator.industries.join(" ")} ${operator.tools.join(" ")}`;
    return `
      <article class="hatcher-row-card" data-hatcher-id="${operator.id}" data-level="${escapeHtml(hatcherLevelBucket(operator.level))}" data-level-num="${levelSortValue(operator.level)}" data-rating="${parseFloat(operator.rating) || 0}" data-completed="${Number(operator.completed) || 0}" data-ontime="${parseFloat(operator.onTime) || 0}" data-score="${hatcherMatchScore(operator, context)}" data-industry="${escapeHtml(operator.industries[0] || "")}" data-industry-list="${escapeHtml(operator.industries.join("|"))}" data-search="${escapeHtml(searchable)}" onclick="SkillNestApp.openOperatorProfile('${operator.id}')">
        <div class="hatcher-row-avatar">${userAvatar(operator, "avatar-xl")}</div>
        <div class="hatcher-row-body">
          <div class="hatcher-row-head">
            <div>
              <h3>${escapeHtml(operator.name)}</h3>
              <p class="hatcher-row-level">${escapeHtml(operator.level)}</p>
            </div>
            <button class="btn secondary small hatcher-message-btn" type="button" onclick="event.stopPropagation(); SkillNestApp.messageHatcher('${operator.id}')">✉️ Message</button>
          </div>
          <p class="hatcher-row-bio">${escapeHtml(operator.bio)}</p>
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
      .sort((a, b) => hatcherMatchScore(b, context) - hatcherMatchScore(a, context))
      .slice(0, 3);

    return `
      <div class="recommendations">
        <div class="card-title-row">
          <h2>Recommended Hatchers</h2>
          <span class="tag">${industry ? `Matched to ${escapeHtml(industry)}` : "Top rated"}</span>
        </div>
        <div class="operator-grid">${recommended.map((operator) => operatorCard(operator, true)).join("")}</div>
      </div>
    `;
  }

  // ── Clients directory ────────────────────────────────────────────────────
  // The Hatcher-facing counterpart to the pieces above: same match-score /
  // card / recommended-row shapes as `operators`, reading client-semantic
  // fields (posted, hireRate, repeatHatcherRate) instead of the Hatcher ones,
  // and reusing the hatcher-row-* presentation classes so both directories
  // look identical. Only one of the two routes renders at a time, so sharing
  // the CSS classes never collides.
  function clientMatchScore(client, context = {}) {
    const rating = clamp01((parseFloat(client.rating) - 4) / 1);
    const hire = clamp01((parseFloat(client.hireRate) - 70) / 30);
    const posted = clamp01(Math.log2((Number(client.posted) || 0) + 1) / Math.log2(51));
    const responseTime = Number.isFinite(client.avgResponseMinutes)
      ? clamp01(1 - (client.avgResponseMinutes - 5) / 175)
      : 0.5;
    const repeatHatchers = clamp01((Number(client.repeatHatcherRate) || 0) / 100);
    const activeDaysAgo = daysSince(client.lastActiveAt);
    const recency = activeDaysAgo === null ? 0.5 : clamp01(1 - activeDaysAgo / 30);

    const baseScore = 100 * (
      HATCHER_SCORE_WEIGHTS.rating * rating +
      HATCHER_SCORE_WEIGHTS.onTime * hire +
      HATCHER_SCORE_WEIGHTS.completed * posted +
      HATCHER_SCORE_WEIGHTS.responseTime * responseTime +
      HATCHER_SCORE_WEIGHTS.repeatClients * repeatHatchers +
      HATCHER_SCORE_WEIGHTS.recency * recency
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
      <article class="hatcher-row-card" data-client-id="${client.id}" data-type="${escapeHtml(client.type)}" data-rating="${parseFloat(client.rating) || 0}" data-posted="${Number(client.posted) || 0}" data-hire="${parseFloat(client.hireRate) || 0}" data-score="${clientMatchScore(client, context)}" data-industry="${escapeHtml(client.industries[0] || "")}" data-industry-list="${escapeHtml(client.industries.join("|"))}" data-search="${escapeHtml(searchable)}" onclick="SkillNestApp.openClientProfile('${client.id}')">
        <div class="hatcher-row-avatar">${userAvatar(client, "avatar-xl")}</div>
        <div class="hatcher-row-body">
          <div class="hatcher-row-head">
            <div>
              <h3>${escapeHtml(client.name)}</h3>
              <p class="hatcher-row-level">${escapeHtml(client.type)}${client.contact ? ` · ${escapeHtml(client.contact)}` : ""}</p>
            </div>
            <button class="btn secondary small hatcher-message-btn" type="button" onclick="event.stopPropagation(); SkillNestApp.messageClient('${client.id}')">✉️ Message</button>
          </div>
          <p class="hatcher-row-bio">${escapeHtml(client.bio)}</p>
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
    return modal(`
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
    const profile = hatcherForWork(work);
    const canOpenProfile = Boolean(work.showProfile && profile);
    const hatcherName = work.showProfile ? (profile?.name || work.hatcherName || "Private Hatcher") : "Private Hatcher";
    const hatcherMeta = work.showProfile
      ? (profile ? `${profile.level} · ${profile.specialization}` : (work.hatcherMeta || "Verified Hatcher"))
      : "Profile hidden";
    const initials = profile?.initials || work.hatcherInitials || "H";
    // Real, client-approved deliverables carry a submission — flag it so people
    // know the card opens to the actual work handed in, not just a summary.
    const hasDeliverable = Boolean(work.submission);
    return `
      <article class="verified-feed-item">
        <div class="verified-feed-head">
          <button class="verified-hatcher-link" type="button" ${canOpenProfile ? `onclick="SkillNestApp.openVerifiedHatcherProfile('${profile.id}')"` : "disabled"} aria-label="View ${escapeHtml(hatcherName)} profile">
            <div class="avatar small-avatar">${escapeHtml(initials)}</div>
          </button>
          <button class="verified-hatcher-link verified-hatcher-name" type="button" ${canOpenProfile ? `onclick="SkillNestApp.openVerifiedHatcherProfile('${profile.id}')"` : "disabled"}>
            <strong>${escapeHtml(hatcherName)}</strong>
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
        <p class="verified-feed-note">${escapeHtml(hatcherMeta)}${hasDeliverable ? ` <span class="verified-deliverable-flag">✓ Delivered result attached</span>` : ""}</p>
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
              <span>${escapeHtml(visibleHatcherName(work))} · ${escapeHtml(visibleEarnings(work))} · ${escapeHtml(visibleCompletionTime(work))}</span>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  // The delivered result the Hatcher actually handed in (submission message +
  // links/files), shown on the verified project detail when a client chose to
  // publish it. Mirrors the attachment rendering used in reviewWorkModal.
  function verifiedDeliverableSection(submission) {
    if (!submission) return "";
    const attachments = Array.isArray(submission.attachments) ? submission.attachments : [];
    return `
      <h2>Delivered result</h2>
      <p>${escapeHtml(submission.message || "The Hatcher's delivered work was approved by the client.")}</p>
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
    const profile = hatcherForWork(work);
    const completedByName = work.showProfile
      ? (profile?.name || work.hatcherName || "Completed by private Hatcher")
      : "Completed by private Hatcher";
    const completedByMeta = work.showProfile
      ? (profile ? `${profile.level} · ${profile.specialization}` : (work.hatcherMeta || "Verified Hatcher"))
      : "Profile hidden for this completed Hatch";
    const completedByInitials = profile?.initials || work.hatcherInitials || "H";
    return modal(`
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
      ${work.showProfile && profile ? `<button class="btn primary full" type="button" onclick="SkillNestApp.openVerifiedHatcherProfile('${profile.id}')">View Hatcher Profile</button>` : ""}
    `);
  }

  function verifiedHatcherProfile(profile) {
    const recent = completedHatches.filter((work) => profile.recentWorkIds.includes(work.id));
    return modal(`
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
      <h2>Recommended Hatcher level</h2>
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

  // Renders the list of files/links a Hatcher has staged for a submission.
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
            <span>Feedback <span class="muted-text small">(optional — sent to the Hatcher)</span></span>
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
        <button class="btn primary full" type="button" onclick="SkillNestApp.messageHatcher('${operator.id}')">✉️ Message <span data-no-i18n>${escapeHtml(operator.name)}</span></button>
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
              <span>To${lockTo ? "" : " (username)"}</span>
              <input id="newMessageTo" type="text" placeholder="username" value="${escapeHtml(preset.to || "")}" ${lockTo ? "readonly" : ""} required />
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
    // Hatchers already reach the levels/ranking content through "About Hatch"
    // below, so they don't get a second link to the same page under a
    // different label — only non-Hatchers get the distinct "apply" CTA.
    const isHatcher = isLoggedIn && /hatcher|operator/i.test(String(account.role || ""));
    const hatcherLink = isHatcher ? "" : `<a href="#operator">Become a Hatcher</a>`;
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
            <a href="#hatchers">Find Hatchers</a>
            <a href="#clients">Browse Clients</a>
            <a href="#verified-work">Verified Results</a>
            ${hatcherLink}
            <a href="#about">About Hatch</a>
            ${profileLink}
          </div>
        </div>
        <div class="footer-bottom">
          ${languagePicker()}
        </div>
      </footer>
    `;
  }

  return {
    buildTaskBrief,
    choiceField,
    conversationAvatar,
    conversationDisplayName,
    conversationItem,
    escapeHtml,
    field,
    footer,
    formatMessageTime,
    languageBadge,
    languageGateModal,
    languagePicker,
    taskLanguageState,
    messageBubble,
    newMessageModal,
    systemAvatar,
    userAvatar,
    assistantConversationMarkup,
    briefReadyForReview,
    fallbackAssistantMessage,
    finalReviewMarkup,
    generateTaskBrief,
    hero,
    taskComposer,
    hatchLifecycleSection,
    messagingFeatureSection,
    whyHatchSection,
    clarificationCardMarkup,
    isLowQualityProjectInput,
    isProjectReady,
    recentlyHatchedSection,
    recentVerifiedWorkSection,
    modal,
    nav,
    statsBanner,
    nextClarification,
    hatcherDirectoryCard,
    hatcherLevelBucket,
    hatcherMatchScore,
    clientDirectoryCard,
    clientMatchScore,
    clientCard,
    clientDetail,
    recommendedClients,
    operatorCard,
    operatorDetail,
    recommendedOperators,
    selectField,
    statusBadge,
    statusInfo,
    tag,
    budgetSortValue,
    completionSortValue,
    levelSortValue,
    formatRangeValue,
    rangeFilterMarkup,
    taskCard,
    taskDetail,
    submitWorkModal,
    reviewWorkModal,
    submissionAttachmentList,
    taskReviewBriefMarkup,
    taskPreviewMarkup,
    textAreaField,
    verifiedHatcherProfile,
    verifiedProjectDetail,
    verifiedWorkCard,
  };
})();
