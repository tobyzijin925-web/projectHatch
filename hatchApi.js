// Server-side only. REST API for accounts and the hatch lifecycle:
// open -> claimed -> in_progress -> submitted -> completed (plus disputed/cancelled).
// Loaded by server.js; not a browser script.

"use strict";

const crypto = require("crypto");
const { db, transact } = require("./db");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Accounts whose email is listed here get admin powers: deleting hatches,
// reviewing operator applications, and messaging any inbox. Emails are not
// verified, so admin belongs to whoever registers the address first — fine
// for local use, revisit before hosting this anywhere public.
// The real admin address is set via HATCH_ADMIN_EMAILS in .env.local (git-
// ignored) so it isn't baked into committed source. The placeholder below is
// only a last-resort default and grants admin to nobody real.
const ADMIN_EMAILS = new Set(
  (process.env.HATCH_ADMIN_EMAILS || "admin@example.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function isAdminUser(user) {
  return Boolean(user && ADMIN_EMAILS.has(String(user.email || "").toLowerCase()));
}

// Canonical machine states live in the database; the frontend renders the
// labels below (see statusInfo in components.js), so responses carry both.
const STATE_LABELS = {
  open: "New Hatch",
  claimed: "Incubating",
  in_progress: "Incubating",
  submitted: "Incubating",
  completed: "Hatched",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

function nowIso() {
  return new Date().toISOString();
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
}

function fail(res, status, error) {
  sendJson(res, status, { ok: false, error });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // Generous enough for a base64 resume attachment, or several base64
      // reference files/images on a posted Hatch (see MAX_HATCH_FILE_CHARS).
      if (body.length > 20_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

// Same backstop as the operator-application resume field (see resumeData
// below): only keep entries that look like a real data: URL under a sane
// size, so a malformed or oversized client payload can't bloat the row.
const MAX_HATCH_FILE_CHARS = 5_000_000; // ~3.7MB raw before base64 overhead
function sanitizeHatchFiles(rawFiles) {
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles
    .filter((file) => file && typeof file === "object")
    .slice(0, 12)
    .map((file) => {
      const objectUrl = String(file.objectUrl || "");
      const validUrl = /^data:/.test(objectUrl) && objectUrl.length <= MAX_HATCH_FILE_CHARS;
      return {
        name: String(file.name || "file").slice(0, 200),
        type: String(file.type || "file").slice(0, 100),
        size: Number(file.size) || 0,
        materialType: String(file.materialType || "Other material").slice(0, 100),
        objectUrl: validUrl ? objectUrl : "",
      };
    });
}

function parseJsonColumn(text) {
  try {
    return JSON.parse(text) || [];
  } catch {
    return [];
  }
}

// ── Passwords and sessions ─────────────────────────────────────────────────

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function passwordMatches(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHash, "hex"));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date(now).toISOString());
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
  return token;
}

function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.email, u.name, u.role, u.joined_at, u.avatar_data, s.token_hash, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(hashToken(token));
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(row.token_hash);
    return null;
  }
  return row;
}

function requireUser(req, res) {
  const user = authenticate(req);
  if (!user) {
    fail(res, 401, "Sign in required. Send an Authorization: Bearer <token> header.");
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!isAdminUser(user)) {
    fail(res, 403, "This action needs an admin account.");
    return null;
  }
  return user;
}

function accountPayload(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    provider: "Email",
    joinedAt: user.joined_at,
    avatar: user.avatar_data || "",
    isAdmin: isAdminUser(user),
  };
}

// ── Hatch serialization (field names match the frontend task shape) ────────

const HATCH_SELECT = `
  SELECT h.*,
    cu.username AS created_by_username, cu.name AS created_by_name,
    bu.username AS claimed_by_username, bu.name AS claimed_by_name
  FROM hatches h
  JOIN users cu ON cu.id = h.created_by
  LEFT JOIN users bu ON bu.id = h.claimed_by
`;

function getHatchRow(id) {
  return db.prepare(`${HATCH_SELECT} WHERE h.id = ?`).get(id);
}

function toClientHatch(row) {
  return {
    id: row.id,
    title: row.title,
    business: row.business,
    objective: row.objective,
    description: row.description,
    budget: row.budget,
    deadline: row.deadline,
    timeline: row.timeline,
    estimatedCompletion: row.estimated_completion,
    industry: row.industry,
    category: row.category,
    level: row.level,
    deliverables: parseJsonColumn(row.deliverables_json),
    scope: parseJsonColumn(row.scope_json),
    references: parseJsonColumn(row.references_json),
    constraints: parseJsonColumn(row.constraints_json),
    missingInfo: parseJsonColumn(row.missing_info_json),
    files: parseJsonColumn(row.files_json),
    status: STATE_LABELS[row.state] || "New Hatch",
    state: row.state,
    createdBy: { id: row.created_by, username: row.created_by_username, name: row.created_by_name },
    claimedBy: row.claimed_by
      ? { id: row.claimed_by, username: row.claimed_by_username, name: row.claimed_by_name }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
  };
}

// ── Messaging core ─────────────────────────────────────────────────────────
// Conversations hold both user-to-user threads (kind 'direct') and updates
// from the platform itself (kind 'system', sender_id NULL, one per user per
// hatch context). Handlers live in the "Messaging handlers" section below.

const MAX_MESSAGE_CHARS = 5000;

function userSummary(row) {
  return { id: row.id, username: row.username, name: row.name, avatar: row.avatar_data || "" };
}

function hatchTitleSnapshot(hatchId) {
  if (!hatchId) return null;
  return db.prepare("SELECT title FROM hatches WHERE id = ?").get(hatchId)?.title || null;
}

function getOrCreateSystemConversation(userId, hatchId = null) {
  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants p ON p.conversation_id = c.id
    WHERE c.kind = 'system' AND p.user_id = ? AND c.hatch_id IS ?
  `).get(userId, hatchId ?? null);
  if (existing) return existing.id;

  const stamp = nowIso();
  const created = db.prepare(
    "INSERT INTO conversations (kind, hatch_id, hatch_title, created_at, updated_at) VALUES ('system', ?, ?, ?, ?)",
  ).run(hatchId ?? null, hatchTitleSnapshot(hatchId), stamp, stamp);
  const id = Number(created.lastInsertRowid);
  db.prepare("INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)").run(id, userId);
  return id;
}

function findDirectConversation(userA, userB, hatchId = null) {
  return db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants pa ON pa.conversation_id = c.id AND pa.user_id = ?
    JOIN conversation_participants pb ON pb.conversation_id = c.id AND pb.user_id = ?
    WHERE c.kind = 'direct' AND c.hatch_id IS ?
  `).get(userA, userB, hatchId ?? null);
}

function getOrCreateDirectConversation(userA, userB, hatchId = null) {
  const existing = findDirectConversation(userA, userB, hatchId);
  if (existing) return existing.id;

  const stamp = nowIso();
  const created = db.prepare(
    "INSERT INTO conversations (kind, hatch_id, hatch_title, created_at, updated_at) VALUES ('direct', ?, ?, ?, ?)",
  ).run(hatchId ?? null, hatchTitleSnapshot(hatchId), stamp, stamp);
  const id = Number(created.lastInsertRowid);
  const addParticipant = db.prepare("INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)");
  addParticipant.run(id, userA);
  addParticipant.run(id, userB);
  return id;
}

// senderId NULL = the Hatch system sender.
function appendMessage(conversationId, senderId, body) {
  const stamp = nowIso();
  db.prepare(
    "INSERT INTO conversation_messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)",
  ).run(conversationId, senderId, body, stamp);
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(stamp, conversationId);
  // New activity pulls the thread back out of everyone's archive — including
  // the sender's own: sending into a thread is the clearest possible signal
  // they want it active again.
  db.prepare(
    "UPDATE conversation_participants SET archived_at = NULL WHERE conversation_id = ?",
  ).run(conversationId);
}

// Drops a system message into a user's inbox, in their system conversation
// for the given hatch (or their general Hatch thread). The senderId/kind of
// the old notification inbox are accepted-and-ignored so the many existing
// call sites don't all need to change: every notify() is a system message
// now, and the subject becomes the message's first line.
function notify(recipientId, { subject = "", body = "", hatchId = null } = {}) {
  if (!recipientId) return;
  const conversationId = getOrCreateSystemConversation(recipientId, hatchId);
  appendMessage(conversationId, null, [subject, body].filter(Boolean).join("\n") || "(no message)");
}

// The conversation row as the given user sees it (their archived flag, the
// other side's identity, unread count, and a preview of the latest message).
function toClientConversation(row, userId) {
  const participants = db.prepare(`
    SELECT u.id, u.username, u.name, u.avatar_data
    FROM conversation_participants p JOIN users u ON u.id = p.user_id
    WHERE p.conversation_id = ? AND p.user_id <> ?
  `).all(row.id, userId).map(userSummary);
  const last = db.prepare(
    "SELECT sender_id, body, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
  ).get(row.id);
  const unread = db.prepare(`
    SELECT COUNT(*) AS n FROM conversation_messages
    WHERE conversation_id = ? AND read_at IS NULL AND (sender_id IS NULL OR sender_id <> ?)
  `).get(row.id, userId).n;
  return {
    id: row.id,
    kind: row.kind,
    hatchId: row.hatch_id,
    // Live title while the hatch exists, snapshot after an admin deletes it.
    hatchTitle: row.hatch_id ? hatchTitleSnapshot(row.hatch_id) || row.hatch_title : null,
    archived: Boolean(row.archived_at),
    participants,
    lastMessage: last
      ? {
        body: last.body,
        fromMe: last.sender_id === userId,
        system: last.sender_id === null,
        createdAt: last.created_at,
      }
      : null,
    unreadCount: unread,
    updatedAt: row.updated_at,
  };
}

// Membership check + the user's own participant row in one query.
function conversationForUser(conversationId, userId) {
  return db.prepare(`
    SELECT c.*, p.archived_at FROM conversations c
    JOIN conversation_participants p ON p.conversation_id = c.id
    WHERE c.id = ? AND p.user_id = ?
  `).get(Number(conversationId), userId);
}

function toClientApplication(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    name: row.name,
    email: row.email,
    background: row.background,
    tools: row.tools,
    industries: row.industries,
    exampleTasks: row.example_tasks,
    status: row.status,
    reviewNote: row.review_note,
    linkedin: row.linkedin || "",
    resumeName: row.resume_name || "",
    resumeData: row.resume_data || "",
    submittedAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function recordEvent(hatchId, fromState, toState, actorId, note) {
  db.prepare(`
    INSERT INTO hatch_events (hatch_id, from_state, to_state, actor_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hatchId, fromState, toState, actorId, note ?? null, nowIso());
}

// ── Payments extension point ───────────────────────────────────────────────
// Runs inside the same transaction as every successful state change, so a
// future escrow integration is all-or-nothing with the transition itself.
// Wire a real provider here: hold funds on open->claimed, release on
// submitted->completed, refund on cancellation/dispute resolution. Until
// then it records stub rows so the ledger shape already exists.
function onStateTransition({ hatchId, fromState, toState }) {
  const intent = {
    "open>claimed": "escrow_hold",
    "submitted>completed": "escrow_release",
  }[`${fromState}>${toState}`];
  if (!intent) return;
  db.prepare("INSERT INTO payments (hatch_id, kind, status, created_at) VALUES (?, ?, 'stub', ?)")
    .run(hatchId, intent, nowIso());
}

// Atomically moves a hatch between states. The UPDATE is conditional on the
// current state (and any extra guard), so concurrent writers cannot both
// succeed; the hatch_state_guard trigger backstops it at the database level.
function transition({ id, actor, allowedFrom, toState, guardSql = "", guardParams = [], setSql = "", setParams = [], note }) {
  return transact(() => {
    const existing = db.prepare("SELECT id, state, created_by, claimed_by FROM hatches WHERE id = ?").get(id);
    if (!existing) return { errorStatus: 404, error: "Hatch not found." };

    const stamp = nowIso();
    const result = db.prepare(`
      UPDATE hatches SET state = ?, updated_at = ? ${setSql}
      WHERE id = ? AND state IN (${allowedFrom.map(() => "?").join(", ")}) ${guardSql}
    `).run(toState, stamp, ...setParams, id, ...allowedFrom, ...guardParams);

    if (result.changes !== 1) {
      return { errorStatus: 409, error: conflictMessage(existing, allowedFrom, toState), state: existing.state };
    }

    recordEvent(id, existing.state, toState, actor.id, note);
    onStateTransition({ hatchId: id, fromState: existing.state, toState, actorId: actor.id });
    return { hatch: toClientHatch(getHatchRow(id)) };
  });
}

function conflictMessage(existing, allowedFrom, toState) {
  if (!allowedFrom.includes(existing.state)) {
    const label = STATE_LABELS[existing.state] || existing.state;
    return `This Hatch is ${label.toLowerCase()} (${existing.state}), so it cannot move to ${toState}.`;
  }
  return "This Hatch changed just before your request. Reload and try again.";
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleSignup(req, res) {
  const body = await readJsonBody(req);
  const username = String(body.username || "").trim();
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  // Accept the current "Operator" roles plus the legacy "Hatcher" wording so
  // older clients (or cached bundles) can still sign up; stored as-is either way.
  const role = ["Client", "Operator", "Client and Operator", "Hatcher", "Client and Hatcher"].includes(body.role) ? body.role : "Client and Operator";

  if (username.length < 3) return fail(res, 400, "Username must be at least 3 characters.");
  if (!name) return fail(res, 400, "Name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, "A valid email is required.");
  if (password.length < 6) return fail(res, 400, "Password must be at least 6 characters.");

  const existing = db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(username, email);
  if (existing) return fail(res, 409, "That username or email is already registered.");

  const { salt, hash } = hashPassword(password);
  const joinedAt = nowIso();
  const inserted = db.prepare(`
    INSERT INTO users (username, email, name, role, password_hash, password_salt, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, email, name, role, hash, salt, joinedAt);

  const user = { id: Number(inserted.lastInsertRowid), username, email, name, role, joined_at: joinedAt };
  notify(user.id, {
    subject: "Welcome to Hatch 🐣",
    body: "Thanks for being an early user. Post what you need done and Chickie will shape it into a clear brief — or claim an open Hatch to build your track record. Updates about your Hatches will arrive here in Messages.",
  });
  sendJson(res, 201, { ok: true, token: createSession(user.id), account: accountPayload(user) });
}

async function handleLogin(req, res) {
  const body = await readJsonBody(req);
  const identity = String(body.usernameOrEmail || body.username || body.email || "").trim();
  const password = String(body.password || "");
  if (!identity || !password) return fail(res, 400, "usernameOrEmail and password are required.");

  const user = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(identity, identity);
  if (!user || !passwordMatches(password, user.password_salt, user.password_hash)) {
    return fail(res, 401, "We couldn't match that login. Check your details and try again.");
  }
  sendJson(res, 200, { ok: true, token: createSession(user.id), account: accountPayload(user) });
}

function handleMe(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  sendJson(res, 200, { ok: true, account: accountPayload(user) });
}

function handleLogout(req, res) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  sendJson(res, 200, { ok: true });
}

async function handleCreateHatch(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);

  const title = String(body.title || "").trim();
  if (!title) return fail(res, 400, "A Hatch needs a title.");

  const id = `hatch-${crypto.randomUUID()}`;
  const stamp = nowIso();
  const text = (value, fallback) => (typeof value === "string" && value.trim() ? value.trim() : fallback);
  const industry = text(body.industry, text(body.category, "General"));

  db.prepare(`
    INSERT INTO hatches (
      id, title, business, objective, description, budget, deadline, timeline,
      estimated_completion, industry, category, level, deliverables_json, scope_json,
      references_json, constraints_json, missing_info_json, files_json,
      state, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    id,
    title,
    text(body.business, text(body.businessType, "Client")),
    text(body.objective, text(body.summary, "")),
    text(body.description, text(body.objective, "")),
    text(body.budget, text(body.suggestedBudget, "Flexible")),
    text(body.deadline, text(body.timeline, "Flexible")),
    text(body.timeline, text(body.deadline, "Flexible")),
    text(body.estimatedCompletion, text(body.timeline, "Flexible")),
    industry,
    text(body.category, industry),
    text(body.level, text(body.suggestedLevel, "L1")),
    JSON.stringify(asStringList(body.deliverables)),
    JSON.stringify(asStringList(body.scope)),
    JSON.stringify(asStringList(body.references)),
    JSON.stringify(asStringList(body.constraints)),
    JSON.stringify(asStringList(body.missingInfo)),
    JSON.stringify(sanitizeHatchFiles(body.files)),
    user.id,
    stamp,
    stamp
  );

  recordEvent(id, null, "open", user.id, "Hatch posted");
  sendJson(res, 201, { ok: true, hatch: toClientHatch(getHatchRow(id)) });
}

function handleListHatches(req, res, url) {
  const state = url.searchParams.get("state") || "open";
  const mine = url.searchParams.get("mine");
  const clauses = [];
  const params = [];

  if (state !== "all") {
    if (!STATE_LABELS[state]) return fail(res, 400, `Unknown state "${state}".`);
    clauses.push("h.state = ?");
    params.push(state);
  }
  if (mine) {
    const user = requireUser(req, res);
    if (!user) return;
    if (mine === "created") clauses.push("h.created_by = ?");
    else if (mine === "claimed") clauses.push("h.claimed_by = ?");
    else return fail(res, 400, 'The "mine" filter must be "created" or "claimed".');
    params.push(user.id);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`${HATCH_SELECT} ${where} ORDER BY h.created_at DESC`).all(...params);
  sendJson(res, 200, { ok: true, hatches: rows.map(toClientHatch) });
}

function handleGetHatch(req, res, id) {
  const row = getHatchRow(id);
  if (!row) return fail(res, 404, "Hatch not found.");

  const events = db.prepare(`
    SELECT e.from_state, e.to_state, e.note, e.created_at, u.username
    FROM hatch_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.hatch_id = ? ORDER BY e.id ASC
  `).all(id).map((event) => ({
    from: event.from_state,
    to: event.to_state,
    note: event.note,
    actor: event.username,
    at: event.created_at,
  }));

  const payload = { ok: true, hatch: toClientHatch(row), events };

  const user = authenticate(req);
  if (user && (user.id === row.created_by || user.id === row.claimed_by)) {
    payload.submissions = db.prepare(`
      SELECT s.id, s.message, s.attachments_json, s.status, s.feedback, s.created_at, s.reviewed_at, u.username
      FROM submissions s JOIN users u ON u.id = s.submitted_by
      WHERE s.hatch_id = ? ORDER BY s.id ASC
    `).all(id).map((sub) => ({
      id: sub.id,
      submittedBy: sub.username,
      message: sub.message,
      attachments: parseJsonColumn(sub.attachments_json),
      status: sub.status,
      feedback: sub.feedback,
      submittedAt: sub.created_at,
      reviewedAt: sub.reviewed_at,
    }));
  }

  sendJson(res, 200, payload);
}

function handleClaim(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;

  const existing = db.prepare("SELECT created_by FROM hatches WHERE id = ?").get(id);
  if (existing && existing.created_by === user.id) {
    return fail(res, 403, "You posted this Hatch, so you can't claim it yourself.");
  }

  // Race-safe: the WHERE state = 'open' condition means exactly one of any
  // number of simultaneous claimers gets changes === 1.
  const result = transition({
    id,
    actor: user,
    allowedFrom: ["open"],
    toState: "claimed",
    guardSql: "AND created_by <> ?",
    guardParams: [user.id],
    setSql: ", claimed_by = ?, claimed_at = ?",
    setParams: [user.id, nowIso()],
    note: `Claimed by ${user.username}`,
  });

  if (result.errorStatus) return fail(res, result.errorStatus, result.error);
  notify(result.hatch.createdBy.id, {
    senderId: user.id,
    kind: "hatcher",
    subject: `${user.username} claimed your Hatch "${result.hatch.title}"`,
    body: "Your Hatch is now incubating. You'll get another update when work is submitted for review.",
    hatchId: id,
  });
  sendJson(res, 200, { ok: true, hatch: result.hatch });
}

function handleStart(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;
  const result = transition({
    id,
    actor: user,
    allowedFrom: ["claimed"],
    toState: "in_progress",
    guardSql: "AND claimed_by = ?",
    guardParams: [user.id],
    note: "Work started",
  });
  if (result.errorStatus) return failTransition(res, result, id, user, "claimed_by", "Only the Operator who claimed this Hatch can start it.");
  sendJson(res, 200, { ok: true, hatch: result.hatch });
}

async function handleSubmit(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const message = String(body.message || body.deliverable || "").trim();
  if (!message) return fail(res, 400, "Describe the deliverable in a message field.");
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 20) : [];

  const result = transition({
    id,
    actor: user,
    allowedFrom: ["claimed", "in_progress"],
    toState: "submitted",
    guardSql: "AND claimed_by = ?",
    guardParams: [user.id],
    note: "Deliverable submitted",
  });
  if (result.errorStatus) return failTransition(res, result, id, user, "claimed_by", "Only the Operator who claimed this Hatch can submit work.");

  db.prepare(`
    INSERT INTO submissions (hatch_id, submitted_by, message, attachments_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, user.id, message, JSON.stringify(attachments), nowIso());

  notify(result.hatch.createdBy.id, {
    senderId: user.id,
    kind: "hatcher",
    subject: `Work submitted on "${result.hatch.title}"`,
    body: `${user.username} submitted a deliverable for your review: ${message}`,
    hatchId: id,
  });
  sendJson(res, 200, { ok: true, hatch: result.hatch });
}

async function handleReview(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const decision = body.decision;
  if (decision !== "approve" && decision !== "reject") {
    return fail(res, 400, 'The decision must be "approve" or "reject".');
  }
  const feedback = String(body.feedback || "").trim() || null;
  const approving = decision === "approve";

  const result = transition({
    id,
    actor: user,
    allowedFrom: ["submitted"],
    toState: approving ? "completed" : "in_progress",
    guardSql: "AND created_by = ?",
    guardParams: [user.id],
    setSql: approving ? ", completed_at = ?" : "",
    setParams: approving ? [nowIso()] : [],
    note: approving ? "Submission approved" : `Submission rejected${feedback ? `: ${feedback}` : ""}`,
  });
  if (result.errorStatus) return failTransition(res, result, id, user, "created_by", "Only the client who posted this Hatch can review submissions.");

  db.prepare(`
    UPDATE submissions SET status = ?, feedback = ?, reviewed_at = ?
    WHERE id = (SELECT MAX(id) FROM submissions WHERE hatch_id = ? AND status = 'pending')
  `).run(approving ? "approved" : "rejected", feedback, nowIso(), id);

  if (result.hatch.claimedBy) {
    notify(result.hatch.claimedBy.id, {
      senderId: user.id,
      kind: "client",
      subject: approving
        ? `Your work on "${result.hatch.title}" was approved`
        : `Changes requested on "${result.hatch.title}"`,
      body: approving
        ? "The client approved your submission. This Hatch is now complete — nice work!"
        : `The client asked for changes${feedback ? `: ${feedback}` : "."}`,
      hatchId: id,
    });
  }
  sendJson(res, 200, { ok: true, hatch: result.hatch });
}

function handleCancel(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;
  const result = transition({
    id,
    actor: user,
    allowedFrom: ["open", "claimed", "in_progress"],
    toState: "cancelled",
    guardSql: "AND created_by = ?",
    guardParams: [user.id],
    note: "Cancelled by client",
  });
  if (result.errorStatus) return failTransition(res, result, id, user, "created_by", "Only the client who posted this Hatch can cancel it.");
  if (result.hatch.claimedBy) {
    notify(result.hatch.claimedBy.id, {
      senderId: user.id,
      kind: "client",
      subject: `The Hatch "${result.hatch.title}" was cancelled`,
      body: "The client cancelled this Hatch, so no further work is needed.",
      hatchId: id,
    });
  }
  sendJson(res, 200, { ok: true, hatch: result.hatch });
}

async function handleDispute(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const note = String(body.note || "").trim() || "Dispute opened";

  const result = transition({
    id,
    actor: user,
    allowedFrom: ["in_progress", "submitted"],
    toState: "disputed",
    guardSql: "AND (created_by = ? OR claimed_by = ?)",
    guardParams: [user.id, user.id],
    note,
  });
  if (result.errorStatus) return failTransition(res, result, id, user, "either", "Only the client or the Operator on this Hatch can open a dispute.");
  const counterpart = result.hatch.createdBy.id === user.id ? result.hatch.claimedBy : result.hatch.createdBy;
  if (counterpart) {
    notify(counterpart.id, {
      senderId: user.id,
      kind: result.hatch.createdBy.id === user.id ? "client" : "hatcher",
      subject: `A dispute was opened on "${result.hatch.title}"`,
      body: note,
      hatchId: id,
    });
  }
  sendJson(res, 200, { ok: true, hatch: result.hatch });
}

// Turns a failed guarded transition into the right status code: 403 when the
// state allowed it but the caller isn't the right party, 409/404 otherwise.
function failTransition(res, result, id, user, party, forbiddenMessage) {
  if (result.errorStatus === 409) {
    const row = db.prepare("SELECT state, created_by, claimed_by FROM hatches WHERE id = ?").get(id);
    if (row) {
      const isParty = party === "created_by" ? row.created_by === user.id
        : party === "claimed_by" ? row.claimed_by === user.id
        : row.created_by === user.id || row.claimed_by === user.id;
      if (!isParty) return fail(res, 403, forbiddenMessage);
    }
  }
  return fail(res, result.errorStatus, result.error);
}

// ── Messaging handlers ─────────────────────────────────────────────────────

function totalUnreadCount(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM conversation_messages m
    JOIN conversation_participants p ON p.conversation_id = m.conversation_id
    WHERE p.user_id = ? AND p.archived_at IS NULL
      AND m.read_at IS NULL AND (m.sender_id IS NULL OR m.sender_id <> ?)
  `).get(userId, userId).n;
}

function handleListConversations(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const rows = db.prepare(`
    SELECT c.*, p.archived_at FROM conversations c
    JOIN conversation_participants p ON p.conversation_id = c.id
    WHERE p.user_id = ? ORDER BY c.updated_at DESC LIMIT 200
  `).all(user.id);
  sendJson(res, 200, {
    ok: true,
    conversations: rows.map((row) => toClientConversation(row, user.id)),
    unreadCount: totalUnreadCount(user.id),
  });
}

function handleUnreadCount(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  sendJson(res, 200, { ok: true, unreadCount: totalUnreadCount(user.id) });
}

function handleGetConversation(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;
  const row = conversationForUser(id, user.id);
  if (!row) return fail(res, 404, "Conversation not found.");

  // Newest 500, then reversed to chronological — truncating from the old end
  // would permanently hide every message after the 500th in a busy thread.
  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.body, m.created_at, m.read_at,
      u.id AS user_id, u.username, u.name, u.avatar_data
    FROM conversation_messages m LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 500
  `).all(row.id).reverse().map((message) => ({
    id: message.id,
    body: message.body,
    system: message.sender_id === null,
    fromMe: message.sender_id === user.id,
    sender: message.sender_id === null
      ? null
      : { id: message.user_id, username: message.username, name: message.name, avatar: message.avatar_data || "" },
    createdAt: message.created_at,
    readAt: message.read_at,
  }));

  sendJson(res, 200, { ok: true, conversation: toClientConversation(row, user.id), messages });
}

function validMessageText(res, rawBody) {
  const text = String(rawBody || "").trim();
  if (!text) {
    fail(res, 400, "The message cannot be empty.");
    return null;
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    fail(res, 400, `Messages are capped at ${MAX_MESSAGE_CHARS} characters.`);
    return null;
  }
  return text;
}

async function handleSendMessage(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;
  const row = conversationForUser(id, user.id);
  if (!row) return fail(res, 404, "Conversation not found.");
  if (row.kind === "system") return fail(res, 403, "You can't reply to updates from Hatch.");

  const body = await readJsonBody(req);
  const text = validMessageText(res, body.body || body.message);
  if (text === null) return;

  appendMessage(row.id, user.id, text);
  // row was read before appendMessage cleared archive flags, so patch the
  // fields appendMessage just changed rather than reporting stale ones.
  sendJson(res, 201, { ok: true, conversation: toClientConversation({ ...row, archived_at: null, updated_at: nowIso() }, user.id) });
}

// Starts (or continues) a direct conversation. The recipient is either named
// explicitly ("to": username or email), or resolved from a hatch the sender
// is on — the client reaches the Operator and vice versa — so the frontend
// can offer "Message" buttons without knowing the counterpart's identity.
async function handleStartConversation(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const text = validMessageText(res, body.body || body.message);
  if (text === null) return;

  const hatchId = String(body.hatchId || "").trim() || null;
  let hatch = null;
  if (hatchId) {
    hatch = db.prepare("SELECT id, title, created_by, claimed_by FROM hatches WHERE id = ?").get(hatchId);
    if (!hatch) return fail(res, 404, "That Hatch no longer exists.");
  }

  const to = String(body.to || "").trim();
  let recipient = null;
  if (to) {
    // Username only: resolving by email would let any account turn a private
    // email address into a username/name/avatar (admins keep the email path
    // in handleAdminMessage, behind requireAdmin).
    recipient = db.prepare("SELECT id, username FROM users WHERE username = ?").get(to);
    if (!recipient) return fail(res, 404, `No account matches "${to}".`);
  } else if (hatch) {
    if (user.id !== hatch.created_by && user.id !== hatch.claimed_by) {
      return fail(res, 403, "Only the client or the Operator on this Hatch can start its conversation.");
    }
    const counterpartId = user.id === hatch.created_by ? hatch.claimed_by : hatch.created_by;
    if (!counterpartId) return fail(res, 400, "No Operator has claimed this Hatch yet.");
    recipient = db.prepare("SELECT id, username FROM users WHERE id = ?").get(counterpartId);
    if (!recipient) return fail(res, 404, "The other person on this Hatch no longer has an account.");
  } else {
    return fail(res, 400, 'Say who the message is for in a "to" field (username), or pass a hatchId.');
  }
  if (recipient.id === user.id) return fail(res, 400, "You can't message yourself.");
  // A hatch tag on the thread implies a real relationship: at least one side
  // must be the hatch's client or Operator. Without this, anyone could dress
  // up a cold message with an official-looking hatch context chip.
  if (hatch) {
    const pair = [user.id, recipient.id];
    if (!pair.includes(hatch.created_by) && !pair.includes(hatch.claimed_by)) {
      return fail(res, 403, "You can only tag a Hatch when you or the recipient is its client or Operator.");
    }
  }

  const conversationId = transact(() => {
    const idFound = getOrCreateDirectConversation(user.id, recipient.id, hatch ? hatch.id : null);
    appendMessage(idFound, user.id, text);
    return idFound;
  });

  const row = conversationForUser(conversationId, user.id);
  sendJson(res, 201, { ok: true, conversation: toClientConversation(row, user.id) });
}

function handleMarkConversationRead(req, res, id) {
  const user = requireUser(req, res);
  if (!user) return;
  const row = conversationForUser(id, user.id);
  if (!row) return fail(res, 404, "Conversation not found.");
  db.prepare(`
    UPDATE conversation_messages SET read_at = ?
    WHERE conversation_id = ? AND read_at IS NULL AND (sender_id IS NULL OR sender_id <> ?)
  `).run(nowIso(), row.id, user.id);
  sendJson(res, 200, { ok: true, unreadCount: totalUnreadCount(user.id) });
}

function handleArchiveConversation(req, res, id, archived) {
  const user = requireUser(req, res);
  if (!user) return;
  const result = db.prepare(
    "UPDATE conversation_participants SET archived_at = ? WHERE conversation_id = ? AND user_id = ?",
  ).run(archived ? nowIso() : null, Number(id), user.id);
  if (result.changes !== 1) return fail(res, 404, "Conversation not found.");
  sendJson(res, 200, { ok: true });
}

// ── Account profile handler ────────────────────────────────────────────────

// Updates the signed-in user's display name and/or avatar. The avatar is a
// data: URL the client already downscaled; the cap here is the server-side
// backstop against oversized rows.
const MAX_AVATAR_CHARS = 500_000;

async function handleUpdateProfile(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return fail(res, 400, "Name cannot be empty.");
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name.slice(0, 120), user.id);
  }
  if (body.removeAvatar === true) {
    db.prepare("UPDATE users SET avatar_data = '' WHERE id = ?").run(user.id);
  } else if (body.avatarData !== undefined) {
    const avatar = String(body.avatarData || "");
    if (!/^data:image\//.test(avatar)) return fail(res, 400, "The avatar must be an image.");
    if (avatar.length > MAX_AVATAR_CHARS) return fail(res, 400, "That avatar image is too large.");
    db.prepare("UPDATE users SET avatar_data = ? WHERE id = ?").run(avatar, user.id);
  }

  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  sendJson(res, 200, { ok: true, account: accountPayload(fresh) });
}

// ── Operator application handlers ───────────────────────────────────────────

async function handleSubmitApplication(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const text = (value) => String(value || "").trim();

  // Only keep a resume that looks like a data URL, and cap it so a huge upload
  // can't bloat the row. The client caps too; this is the server-side backstop.
  const resumeData = String(body.resumeData || "");
  const resume = /^data:/.test(resumeData) && resumeData.length <= 5_000_000 ? resumeData : "";
  const resumeName = resume ? text(body.resumeName) : "";
  const linkedin = text(body.linkedin);

  // One live application per user: a resubmit replaces their pending row so
  // the admin queue never shows duplicates.
  const stamp = nowIso();
  const result = transact(() => {
    const pending = db.prepare(
      "SELECT id FROM hatcher_applications WHERE user_id = ? AND status = 'pending'",
    ).get(user.id);
    if (pending) {
      db.prepare(`
        UPDATE hatcher_applications
        SET name = ?, email = ?, background = ?, tools = ?, industries = ?, example_tasks = ?,
            linkedin = ?, resume_name = ?, resume_data = ?, created_at = ?
        WHERE id = ?
      `).run(text(body.name) || user.name, user.email, text(body.background), text(body.tools),
        text(body.industries), text(body.exampleTasks), linkedin, resumeName, resume, stamp, pending.id);
      return pending.id;
    }
    const inserted = db.prepare(`
      INSERT INTO hatcher_applications
        (user_id, name, email, background, tools, industries, example_tasks, linkedin, resume_name, resume_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, text(body.name) || user.name, user.email, text(body.background), text(body.tools),
      text(body.industries), text(body.exampleTasks), linkedin, resumeName, resume, stamp);
    return Number(inserted.lastInsertRowid);
  });

  const row = db.prepare(`
    SELECT a.*, u.username FROM hatcher_applications a JOIN users u ON u.id = a.user_id WHERE a.id = ?
  `).get(result);
  sendJson(res, 201, { ok: true, application: toClientApplication(row) });
}

function handleListApplications(req, res, url) {
  const user = requireUser(req, res);
  if (!user) return;
  const wantsAll = url.searchParams.get("all") === "1";
  if (wantsAll && !isAdminUser(user)) return fail(res, 403, "This action needs an admin account.");

  const rows = wantsAll
    ? db.prepare(`
        SELECT a.*, u.username FROM hatcher_applications a JOIN users u ON u.id = a.user_id
        ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.id DESC
      `).all()
    : db.prepare(`
        SELECT a.*, u.username FROM hatcher_applications a JOIN users u ON u.id = a.user_id
        WHERE a.user_id = ? ORDER BY a.id DESC
      `).all(user.id);
  sendJson(res, 200, { ok: true, applications: rows.map(toClientApplication) });
}

async function handleReviewApplication(req, res, id) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJsonBody(req);
  const decision = body.decision;
  if (decision !== "approve" && decision !== "reject") {
    return fail(res, 400, 'The decision must be "approve" or "reject".');
  }
  const approving = decision === "approve";
  const note = String(body.message || body.note || "").trim();

  const outcome = transact(() => {
    const application = db.prepare(
      "SELECT * FROM hatcher_applications WHERE id = ?",
    ).get(Number(id));
    if (!application) return { errorStatus: 404, error: "Application not found." };
    if (application.status !== "pending") {
      return { errorStatus: 409, error: `This application was already ${application.status}.` };
    }

    db.prepare(`
      UPDATE hatcher_applications SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ?
    `).run(approving ? "approved" : "rejected", note || null, admin.id, nowIso(), application.id);

    if (approving) {
      // Grant the Operator role without dropping an existing Client role.
      db.prepare("UPDATE users SET role = CASE WHEN role = 'Client' THEN 'Client and Operator' ELSE role END WHERE id = ?")
        .run(application.user_id);
    }

    notify(application.user_id, {
      senderId: admin.id,
      kind: "admin",
      subject: approving ? "Your Operator application was approved" : "Your Operator application was not approved",
      body: note || (approving
        ? "Welcome aboard! You can now claim Hatches from the Browse page."
        : "Thanks for applying. You can update and resubmit your application from the Become an Operator page."),
    });
    return { application };
  });

  if (outcome.errorStatus) return fail(res, outcome.errorStatus, outcome.error);
  const row = db.prepare(`
    SELECT a.*, u.username FROM hatcher_applications a JOIN users u ON u.id = a.user_id WHERE a.id = ?
  `).get(Number(id));
  sendJson(res, 200, { ok: true, application: toClientApplication(row) });
}

// ── Admin handlers ─────────────────────────────────────────────────────────

async function handleAdminDeleteHatch(req, res, id) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJsonBody(req).catch(() => ({}));
  const note = String(body.note || "").trim();

  const outcome = transact(() => {
    const hatch = db.prepare("SELECT id, title, created_by, claimed_by FROM hatches WHERE id = ?").get(id);
    if (!hatch) return { errorStatus: 404, error: "Hatch not found." };

    // The notice invites a reply ("...if you think this was a mistake"), so
    // it goes out as a direct message from the deleting admin — system
    // conversations refuse replies. Sent before the DELETE while the hatch
    // row still exists.
    const bodyText = note || "An admin removed this Hatch. Reply to this message if you think this was a mistake.";
    const sendNotice = (userId, subjectText) => {
      if (!userId || userId === admin.id) return;
      const conversationId = getOrCreateDirectConversation(admin.id, userId, null);
      appendMessage(conversationId, admin.id, [subjectText, bodyText].join("\n"));
    };
    sendNotice(hatch.created_by, `Your Hatch "${hatch.title}" was removed`);
    if (hatch.claimed_by && hatch.claimed_by !== hatch.created_by) {
      sendNotice(hatch.claimed_by, `The Hatch "${hatch.title}" you were working on was removed`);
    }

    // Children first: these tables reference hatches(id) without cascades.
    db.prepare("DELETE FROM payments WHERE hatch_id = ?").run(id);
    db.prepare("DELETE FROM submissions WHERE hatch_id = ?").run(id);
    db.prepare("DELETE FROM hatch_events WHERE hatch_id = ?").run(id);
    db.prepare("DELETE FROM hatches WHERE id = ?").run(id);
    return {};
  });

  if (outcome.errorStatus) return fail(res, outcome.errorStatus, outcome.error);
  sendJson(res, 200, { ok: true, deleted: id });
}

// Sends a direct message from the admin's own account, so the recipient can
// reply to it like any other conversation (the old version dropped a one-way
// note into the notification inbox).
async function handleAdminMessage(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJsonBody(req);
  const to = String(body.to || body.username || body.email || "").trim();
  const messageBody = String(body.body || body.message || "").trim();
  if (!to) return fail(res, 400, 'Say who the message is for in a "to" field (username or email).');
  if (!messageBody) return fail(res, 400, "The message body cannot be empty.");

  const recipient = db.prepare("SELECT id, username FROM users WHERE username = ? OR email = ?").get(to, to);
  if (!recipient) return fail(res, 404, `No account matches "${to}".`);
  if (recipient.id === admin.id) return fail(res, 400, "You can't message yourself.");

  const subject = String(body.subject || "").trim();
  transact(() => {
    const conversationId = getOrCreateDirectConversation(admin.id, recipient.id, null);
    appendMessage(conversationId, admin.id, [subject, messageBody].filter(Boolean).join("\n"));
  });
  sendJson(res, 200, { ok: true, to: recipient.username });
}

// ── Site stats banner ────────────────────────────────────────────────────
// Vanity metrics shown in the rolling banner under the top nav. Admin-set and
// stored as a single JSON blob in the meta table, then served publicly (no
// auth) so every visitor — signed in or not — sees the same numbers. The
// previewMode flag reframes them as "what the live dashboard will show as we
// grow" until a founder flips it to live, which is why it defaults to true.
const SITE_STATS_KEY = "site_stats";
const SITE_STATS_FIELDS = ["people", "openHatches", "activeHatchers", "activeClients", "hatchesLastWeek"];

function defaultSiteStats() {
  return {
    people: 200,
    openHatches: 45,
    activeHatchers: 120,
    activeClients: 80,
    hatchesLastWeek: 60,
    previewMode: true,
    updatedAt: null,
  };
}

function readSiteStats() {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SITE_STATS_KEY);
  if (!row) return defaultSiteStats();
  try {
    const stored = JSON.parse(row.value);
    const stats = defaultSiteStats();
    SITE_STATS_FIELDS.forEach((field) => {
      const value = Number(stored[field]);
      if (Number.isFinite(value)) stats[field] = Math.max(0, Math.round(value));
    });
    stats.previewMode = Boolean(stored.previewMode);
    stats.updatedAt = stored.updatedAt || null;
    return stats;
  } catch {
    return defaultSiteStats();
  }
}

function handleGetSiteStats(req, res) {
  sendJson(res, 200, { ok: true, stats: readSiteStats() });
}

async function handleSetSiteStats(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJsonBody(req).catch(() => ({}));
  const stats = readSiteStats();
  SITE_STATS_FIELDS.forEach((field) => {
    if (body[field] === undefined || body[field] === "") return;
    const value = Number(body[field]);
    if (Number.isFinite(value)) stats[field] = Math.max(0, Math.min(100_000_000, Math.round(value)));
  });
  if (body.previewMode !== undefined) stats.previewMode = Boolean(body.previewMode);
  stats.updatedAt = nowIso();
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(SITE_STATS_KEY, JSON.stringify(stats));
  sendJson(res, 200, { ok: true, stats });
}

// ── Router ─────────────────────────────────────────────────────────────────

const HATCH_ACTIONS = {
  claim: handleClaim,
  start: handleStart,
  submit: handleSubmit,
  review: handleReview,
  cancel: handleCancel,
  dispute: handleDispute,
};

async function route(req, res, url) {
  const p = url.pathname;

  if (req.method === "POST" && p === "/api/auth/signup") return handleSignup(req, res);
  if (req.method === "POST" && p === "/api/auth/login") return handleLogin(req, res);
  if (req.method === "GET" && p === "/api/auth/me") return handleMe(req, res);
  if (req.method === "POST" && p === "/api/auth/logout") return handleLogout(req, res);
  if (req.method === "POST" && p === "/api/auth/profile") return handleUpdateProfile(req, res);

  if (req.method === "GET" && p === "/api/messages/conversations") return handleListConversations(req, res);
  if (req.method === "POST" && p === "/api/messages/start") return handleStartConversation(req, res);
  if (req.method === "GET" && p === "/api/messages/unread-count") return handleUnreadCount(req, res);

  if (p === "/api/hatcher-applications") {
    if (req.method === "GET") return handleListApplications(req, res, url);
    if (req.method === "POST") return handleSubmitApplication(req, res);
    return fail(res, 405, "Method not allowed.");
  }

  if (req.method === "POST" && p === "/api/admin/messages") return handleAdminMessage(req, res);

  if (p === "/api/site-stats") {
    if (req.method === "GET") return handleGetSiteStats(req, res);
    if (req.method === "POST") return handleSetSiteStats(req, res);
    return fail(res, 405, "Method not allowed.");
  }

  if (p === "/api/hatches") {
    if (req.method === "GET") return handleListHatches(req, res, url);
    if (req.method === "POST") return handleCreateHatch(req, res);
    return fail(res, 405, "Method not allowed.");
  }

  const parts = p.split("/").filter(Boolean); // ["api", section, id, action?]
  if (parts[0] === "api" && parts[1] === "messages" && parts[2] === "conversations" && parts[3] && req.method === "GET" && parts.length === 4) {
    return handleGetConversation(req, res, parts[3]);
  }
  if (parts[0] === "api" && parts[1] === "messages" && parts[2] === "conversations" && parts[3] && req.method === "POST") {
    if (parts.length === 4) return handleSendMessage(req, res, parts[3]);
    if (parts.length === 5 && parts[4] === "read") return handleMarkConversationRead(req, res, parts[3]);
    if (parts.length === 5 && parts[4] === "archive") return handleArchiveConversation(req, res, parts[3], true);
    if (parts.length === 5 && parts[4] === "unarchive") return handleArchiveConversation(req, res, parts[3], false);
  }
  if (parts[0] === "api" && parts[1] === "hatcher-applications" && parts.length === 4 && parts[3] === "review" && req.method === "POST") {
    return handleReviewApplication(req, res, parts[2]);
  }
  if (parts[0] === "api" && parts[1] === "hatches" && parts[2]) {
    const id = decodeURIComponent(parts[2]);
    if (parts.length === 3 && req.method === "GET") return handleGetHatch(req, res, id);
    if (parts.length === 3 && req.method === "DELETE") return handleAdminDeleteHatch(req, res, id);
    if (parts.length === 4 && req.method === "POST" && HATCH_ACTIONS[parts[3]]) {
      return HATCH_ACTIONS[parts[3]](req, res, id);
    }
  }

  return fail(res, 404, "Unknown API route.");
}

const API_PREFIXES = ["/api/auth", "/api/hatches", "/api/messages", "/api/hatcher-applications", "/api/admin", "/api/site-stats"];

// Returns true when the request was an API route this module owns.
function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (!API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return false;
  }
  route(req, res, url).catch((error) => {
    const status = error.statusCode || 500;
    console.error("[Hatch API]", req.method, url.pathname, error.message);
    if (!res.headersSent) fail(res, status, status === 500 ? "Something went wrong on the server." : error.message);
  });
  return true;
}

module.exports = { handle };
