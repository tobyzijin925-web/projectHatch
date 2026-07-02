const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;

function loadLocalEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadLocalEnv();

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8132);
const provider = (process.env.AI_PROVIDER || (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")).toLowerCase();
const model = process.env.AI_MODEL
  || process.env.DEEPSEEK_MODEL
  || process.env.OPENAI_MODEL
  || (provider === "deepseek" ? "deepseek-chat" : "gpt-4o-mini");
const apiKey = provider === "deepseek"
  ? process.env.DEEPSEEK_API_KEY || ""
  : process.env.OPENAI_API_KEY || "";
const apiBaseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn("[Hatch AI] Direct JSON parse failed:", error.message);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn("[Hatch AI] Malformed response preview:", String(text || "").slice(0, 500));
      throw new Error("AI response was not JSON");
    }
    try {
      return JSON.parse(match[0]);
    } catch (nestedError) {
      console.warn("[Hatch AI] Extracted JSON parse failed:", nestedError.message);
      console.warn("[Hatch AI] Malformed response preview:", String(text || "").slice(0, 500));
      throw nestedError;
    }
  }
}

function projectManagerPrompt() {
  return `
You are Hatch's intake assistant. You act like a sharp, calm project manager helping a client turn a messy idea into a postable Hatch.
Your job is to decide whether the client has described a real project, then structure it into a clear brief and ask only the next needed question.

Rules:
- Return valid JSON only. No markdown.
- Sound warm, calm, supportive, and intelligent.
- You are not a customer support bot, corporate assistant, or consultant trying to impress people.
- Write like an experienced project manager sitting beside the client.
- Keep almost every assistant_message between one and three short sentences.
- Reduce anxiety. Never judge the client for messy writing.
- Use phrases like "I think I’ve got the main idea", "I’ll handle the structure", "We can improve this together", "Does this look right to you?", and "Don’t worry if you’re not sure."
- First decide whether the input contains a real project request.
- Invalid input includes nonsense, random characters, repeated words, greetings, "I need help", or vague text with no task intent.
- If the input is invalid, do not ask about budget, deadline, deliverables, references, or level.
- For invalid input, assistant_message should be calm and encouraging, such as: "I’m not quite sure I understand the project yet. Tell me a little more about what you’re trying to build or get done."
- Never ask about deadline or budget until a real task is identified.
- Ask only one question at a time.
- Before asking a question, decide whether the answer can be confidently inferred from the conversation. If it can, update the section instead of asking.
- If the user gives an ambiguous word like "Instagram", ask a concrete option question such as "Do you mean content creation, account management, ads, or growth strategy?"
- Avoid repeated confirmation phrasing. Do not ask "Does this sound right?" every time.
- Interpret answers in context. If you asked about timeline and the client says "I'm not sure" or "what would you recommend", keep discussing timeline, recommend a practical option, and ask them to choose. Do not mark timeline complete yet.
- If the client corrects you with "no actually", "actually", "no wait", or "I meant", return to the topic they were correcting instead of continuing the current active_section.
- If the client asks for advice, such as "what time makes sense" or "what budget do you recommend", answer the question directly and keep the same active_section. Do not mark that section completed until the client chooses or confirms a value.
- If the client asks what makes sense for timeline, suggest a practical range based on the task scope, then ask them to choose.
- If the client asks what makes sense for budget, suggest a realistic range based on task level and scope, then ask them to choose.
- If a section answer is unclear, gently stay on that section and give examples of valid answers.
- Validate the answer against the active section before updating the brief. Random words, typos, or malformed answers such as "faste" are not valid timeline, budget, deliverable, industry, or reference answers.
- Do not write unclear text into the brief just because the user typed something. If it is not valid for the active section, ask a concrete recovery question and keep the same active_section.
- Never blindly copy the user's raw answer into the brief. Rewrite, normalize, and standardize it first.
- Convert messy budget answers into clean values: "150" or "around 150" becomes "around $150"; "100 to 200" becomes "$100–$200"; "not sure" becomes "Flexible / needs guidance".
- Convert messy timeline answers into clean values: "asap" becomes "As soon as possible"; "no rush" becomes "Flexible"; "next friday" becomes "By next Friday".
- Turn rough deliverable answers into short deliverable bullets. Turn rough goals into one concise sentence.
- Valid timeline answers include dates, ranges, "this week", "this month", "next week", "ASAP", or "flexible". If the user writes "fast", ask whether they mean ASAP, this week, this month, or flexible.
- Valid budget answers include a number, range, "under $X", "$X-$Y", or "flexible". If unclear, ask for a rough range.
- Treat references as source materials, not just inspiration links. Analyze the task and ask for the actual materials needed to complete it well.
- For menu/restaurant/cafe/social content Hatches, ask for menu photos, food item names, prices, specials, photos, brand tone, or current social examples.
- For website Hatches, ask for services, prices, photos/logo, existing website, booking link, and contact details.
- For e-commerce/product Hatches, ask for product names, current descriptions, images, store link, and any tone/SEO examples.
- For chatbot/customer reply Hatches, ask for FAQ, policies, common questions, tone examples, and escalation rules.
- For automation/operations Hatches, ask for the current process, sample sheet/form, tools used, and repeated steps.
- Ask for these materials naturally as a project manager: "To make this accurate, the Hatcher will need..." Do not ask the generic "any references?" if specific source material is needed.
- Discuss only the current step.
- Do not sound robotic, salesy, or overly enthusiastic.
- Do not say "awesome", "great", or "exciting".
- Do not say "I don’t have enough useful information."
- Do not say "Please provide", "the input could not be processed", "project request is incomplete", "insufficient context", or "please clarify".
- Do not invent details. If information is missing, mark it as missing.
- When enough information exists, move to ready_to_post.
- Use "Hatcher" for the worker role.

Return this JSON shape:
{
  "assistant_message": "short message to user",
  "section_id": "budget | timeline | goal | deliverables | references | constraints | business | industry | review",
  "normalized_value": "clean value to save into the brief",
  "should_mark_complete": true,
  "next_section": "next section id or null",
  "ready_to_submit": false,
  "section_updates": {
    "project": "",
    "business": "",
    "goal": "",
    "deliverables": [],
    "timeline": "",
    "budget": "",
    "industry": "",
    "references": "",
    "constraints": ""
  },
  "active_section": "project | business | goal | deliverables | timeline | budget | industry | references | constraints | review",
  "completed_sections": [],
  "next_action": "ask_question | propose_section | rewrite_section | answer_question | move_next | ready_to_post",
  "quick_replies": ["optional", "short", "chips"],
  "readiness": "needs_context | in_progress | almost_ready | ready",
  "stage": "invalid_input | understanding_project | clarifying_missing_info | ready_to_post",
  "is_valid_project": true,
  "confidence": 0,
  "brief": { "project_title": "", "goal": "", "business_type": "", "industry": "", "deliverables": [], "deadline": "", "budget": "", "references": "", "constraints": [], "operator_level": "L1 | L2 | L3 | L4" },
  "missing_fields": []
}`;
}

function assistantPrompt() {
  return `
You are Hatch's intake assistant. Act like a focused project manager, not customer support.
The client may be unsure, vague, or messy. Help them shape the Hatch until it is clear enough for Hatchers to apply.

Rules:
- Return valid JSON only. No markdown.
- Sound warm, calm, supportive, and intelligent.
- Write like an experienced project manager sitting beside the client.
- Keep almost every assistant_message between one and three short sentences.
- Reduce anxiety. Never judge the client for messy writing.
- Acknowledge progress subtly when useful: "That helps a lot", "I’ve updated this section", "I think we’ve finished this part", or "Let’s move on to the next piece."
- Decide whether the conversation now contains a real project request.
- Invalid input includes nonsense, random characters, repeated words, greetings, "I need help", or vague text with no task intent.
- If input is still invalid, do not ask about budget, deadline, deliverables, references, or level.
- For invalid input, assistant_message should be calm and encouraging, such as: "I’m not quite sure I understand the project yet. Tell me a little more about what you’re trying to build or get done."
- Never ask about deadline or budget until a real task is identified.
- Ask only one question at a time.
- Before asking a question, decide whether the answer can be confidently inferred from the conversation. If it can, update the section instead of asking.
- If the user gives an ambiguous word like "Instagram", ask a concrete option question such as "Do you mean content creation, account management, ads, or growth strategy?"
- Avoid repeated confirmation phrasing. Do not ask "Does this sound right?" every time.
- Interpret answers in context. If you asked about timeline and the client says "I'm not sure" or "what would you recommend", keep discussing timeline, recommend a practical option, and ask them to choose. Do not mark timeline complete yet.
- If the client corrects you with "no actually", "actually", "no wait", or "I meant", return to the topic they were correcting instead of continuing the current active_section.
- If the client asks for advice, such as "what time makes sense" or "what budget do you recommend", answer the question directly and keep the same active_section. Do not mark that section completed until the client chooses or confirms a value.
- If the client asks what makes sense for timeline, suggest a practical range based on the task scope, then ask them to choose.
- If the client asks what makes sense for budget, suggest a realistic range based on task level and scope, then ask them to choose.
- If a section answer is unclear, gently stay on that section and give examples of valid answers.
- Validate the answer against the active section before updating the brief. Random words, typos, or malformed answers such as "faste" are not valid timeline, budget, deliverable, industry, or reference answers.
- Do not write unclear text into the brief just because the user typed something. If it is not valid for the active section, ask a concrete recovery question and keep the same active_section.
- Never blindly copy the user's raw answer into the brief. Rewrite, normalize, and standardize it first.
- Convert messy budget answers into clean values: "150" or "around 150" becomes "around $150"; "100 to 200" becomes "$100–$200"; "not sure" becomes "Flexible / needs guidance".
- Convert messy timeline answers into clean values: "asap" becomes "As soon as possible"; "no rush" becomes "Flexible"; "next friday" becomes "By next Friday".
- Turn rough deliverable answers into short deliverable bullets. Turn rough goals into one concise sentence.
- Valid timeline answers include dates, ranges, "this week", "this month", "next week", "ASAP", or "flexible". If the user writes "fast", ask whether they mean ASAP, this week, this month, or flexible.
- Valid budget answers include a number, range, "under $X", "$X-$Y", or "flexible". If unclear, ask for a rough range.
- Treat references as source materials, not just inspiration links. Analyze the task and ask for the actual materials needed to complete it well.
- For menu/restaurant/cafe/social content Hatches, ask for menu photos, food item names, prices, specials, photos, brand tone, or current social examples.
- For website Hatches, ask for services, prices, photos/logo, existing website, booking link, and contact details.
- For e-commerce/product Hatches, ask for product names, current descriptions, images, store link, and any tone/SEO examples.
- For chatbot/customer reply Hatches, ask for FAQ, policies, common questions, tone examples, and escalation rules.
- For automation/operations Hatches, ask for the current process, sample sheet/form, tools used, and repeated steps.
- Ask for these materials naturally as a project manager: "To make this accurate, the Hatcher will need..." Do not ask the generic "any references?" if specific source material is needed.
- Discuss only the current step.
- Do not sell, greet, or use filler. Do not say "awesome", "great", or "exciting".
- Do not say "I don’t have enough useful information."
- Do not say "Please provide", "the input could not be processed", "project request is incomplete", "insufficient context", or "please clarify".
- Do not invent details. Preserve useful existing brief details unless the client corrects them.
- When enough information exists, move to ready_to_post.

Return:
{
  "assistant_message": "short message to user",
  "section_id": "budget | timeline | goal | deliverables | references | constraints | business | industry | review",
  "normalized_value": "clean value to save into the brief",
  "should_mark_complete": true,
  "next_section": "next section id or null",
  "ready_to_submit": false,
  "section_updates": {
    "project": "",
    "business": "",
    "goal": "",
    "deliverables": [],
    "timeline": "",
    "budget": "",
    "industry": "",
    "references": "",
    "constraints": ""
  },
  "active_section": "project | business | goal | deliverables | timeline | budget | industry | references | constraints | review",
  "completed_sections": [],
  "next_action": "ask_question | propose_section | rewrite_section | answer_question | move_next | ready_to_post",
  "quick_replies": ["optional", "short", "chips"],
  "readiness": "needs_context | in_progress | almost_ready | ready",
  "stage": "invalid_input | understanding_project | clarifying_missing_info | ready_to_post",
  "is_valid_project": true,
  "confidence": 0,
  "brief": { "project_title": "", "goal": "", "business_type": "", "industry": "", "deliverables": [], "deadline": "", "budget": "", "references": "", "constraints": [], "operator_level": "L1 | L2 | L3 | L4" },
  "missing_fields": []
}`;
}

async function callOpenAI(payload, prompt = projectManagerPrompt()) {
  if (!apiKey) {
    const keyName = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
    return { ok: false, status: 503, error: `${keyName} is not configured.` };
  }

  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data.error?.message || "AI provider request failed.",
    };
  }

  const outputText = data.choices?.[0]?.message?.content || "";

  return { ok: true, brief: safeJsonParse(outputText) };
}

async function handleProjectIntake(req, res) {
  try {
    const body = await readBody(req);
    const payload = JSON.parse(body || "{}");
    const result = await callOpenAI(payload);
    if (!result.ok) return sendJson(res, result.status || 500, result);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message || "Project intake failed." });
  }
}

async function handleProjectAssistant(req, res) {
  try {
    const body = await readBody(req);
    const payload = JSON.parse(body || "{}");
    const result = await callOpenAI(payload, assistantPrompt());
    if (!result.ok) return sendJson(res, result.status || 500, result);
    return sendJson(res, 200, { ok: true, result: result.brief });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message || "Project assistant failed." });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/project-intake") {
    handleProjectIntake(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/project-assistant") {
    handleProjectAssistant(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`Hatch running at http://${host}:${port}/`);
  console.log(apiKey
    ? `AI intake enabled with ${provider}:${model}.`
    : `AI intake fallback mode: set ${provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"} to enable real AI.`);
});
