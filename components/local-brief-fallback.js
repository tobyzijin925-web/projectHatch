// Split out of components.js: the rule-based project-brief generator used
// when the DeepSeek/Groq call fails (see aiController.js's fallback path).
// Self-contained — no dependency on window.SkillNestData, only on the text
// primitives from components/primitives.js, loaded just before this file.
window.SkillNestComponents = window.SkillNestComponents || {};
Object.assign(window.SkillNestComponents, (() => {
  const { escapeHtml, sentenceTitle, cleanSentence, normalizeTaskText } = window.SkillNestComponents;

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
      recommendedOperatorType: level === "L3" || level === "L4" ? `${level} specialist Operator` : `${level} practical Operator`,
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
    return "It sounds like you have a practical project that needs to be shaped into clear work an Operator can execute.";
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
        reason: "The Operator needs the actual food details so the work is accurate, not generic.",
        prompt: "Can you provide a menu photo/link, item list with prices, or examples of your current style?",
        suggestions: ["I can attach a menu", "I can paste food items", "No menu yet", "Use best judgment"],
        placeholder: "Paste menu items, prices, links, or notes",
      };
    }
    if (text.includes("website") || text.includes("salon") || text.includes("booking")) {
      return {
        key: "references",
        reason: "The Operator needs the real services, prices, photos, and booking details.",
        prompt: "What source material can you provide for the website?",
        suggestions: ["Services and prices", "Photos/logo", "Existing website", "No materials yet"],
        placeholder: "Paste services, prices, links, or notes",
      };
    }
    if (text.includes("product") || text.includes("shopify") || text.includes("e-commerce") || text.includes("ecommerce")) {
      return {
        key: "references",
        reason: "The Operator needs product details to avoid guessing.",
        prompt: "Can you share product names, current descriptions, photos, or a store link?",
        suggestions: ["Product list", "Store link", "Current descriptions", "No materials yet"],
        placeholder: "Paste product details, links, or notes",
      };
    }
    if (text.includes("faq") || text.includes("chatbot") || text.includes("support") || text.includes("reply")) {
      return {
        key: "references",
        reason: "The Operator needs real customer questions and policies to write useful replies.",
        prompt: "Can you share your FAQ, policies, common questions, or tone examples?",
        suggestions: ["FAQ/policies", "Common questions", "Tone examples", "No materials yet"],
        placeholder: "Paste FAQ, policies, questions, or notes",
      };
    }
    return {
      key: "references",
      reason: "Source material helps the Operator work from real context instead of guessing.",
      prompt: "What source material should the Operator use?",
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
        reason: "Budget helps keep the project realistic before Operators apply.",
        prompt: "What budget range are you comfortable with?",
        suggestions: ["Under $100", "$100-300", "$300-1000", "Flexible"],
        placeholder: "Custom budget",
      };
    }
    if (missing.includes("industry")) {
      return {
        key: "industry",
        reason: "The business context changes the examples, tools, and Operator experience that matter.",
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

  return {
    isLowQualityProjectInput,
    generateTaskBrief,
    isProjectReady,
    projectReadiness,
    understandingStatement,
    nextClarification,
    fallbackAssistantMessage,
    buildTaskBrief,
    taskBriefPreviewMarkup,
    suggestedObjective,
  };
})());
