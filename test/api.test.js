// End-to-end tests for the hatch sync API. Boots the real server on a test
// port with a throwaway database, then exercises the lifecycle over HTTP.
// Run with: node --test test/api.test.js

"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 8461;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProcess;
let tempDir;

async function api(method, endpoint, { token, body } = {}) {
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

let userCounter = 0;
async function signup(overrides = {}) {
  userCounter += 1;
  const { status, body } = await api("POST", "/api/auth/signup", {
    body: {
      username: `user${userCounter}`,
      name: `User ${userCounter}`,
      email: `user${userCounter}@example.com`,
      password: "hunter22",
      ...overrides,
    },
  });
  assert.equal(status, 201, `signup failed: ${JSON.stringify(body)}`);
  return body;
}

async function createHatch(token, overrides = {}) {
  const { status, body } = await api("POST", "/api/hatches", {
    token,
    body: { title: "Design a menu for a bakery", budget: "$100 - $200", ...overrides },
  });
  assert.equal(status, 201, `create failed: ${JSON.stringify(body)}`);
  return body.hatch;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hatch-api-test-"));
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      HATCH_DB_PATH: path.join(tempDir, "test.db"),
      HATCH_ADMIN_EMAILS: "admin@test.local",
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(`${BASE}/api/ai-status`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Test server did not start.");
});

after(() => {
  serverProcess?.kill();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test("signup, duplicate rejection, and login", async () => {
  const created = await signup({ username: "authcheck", email: "authcheck@example.com" });
  assert.ok(created.token);
  assert.equal(created.account.username, "authcheck");
  assert.equal(created.account.password, undefined);

  const duplicate = await api("POST", "/api/auth/signup", {
    body: { username: "authcheck", name: "X", email: "other@example.com", password: "hunter22" },
  });
  assert.equal(duplicate.status, 409);

  const badLogin = await api("POST", "/api/auth/login", {
    body: { usernameOrEmail: "authcheck", password: "wrong-password" },
  });
  assert.equal(badLogin.status, 401);

  const login = await api("POST", "/api/auth/login", {
    body: { usernameOrEmail: "authcheck@example.com", password: "hunter22" },
  });
  assert.equal(login.status, 200);

  const me = await api("GET", "/api/auth/me", { token: login.body.token });
  assert.equal(me.body.account.email, "authcheck@example.com");
});

test("create requires auth and identity comes from the token, not the body", async () => {
  const anonymous = await api("POST", "/api/hatches", { body: { title: "No login" } });
  assert.equal(anonymous.status, 401);

  const client = await signup();
  const hatch = await createHatch(client.token, { createdBy: "someone-else", created_by: 999 });
  assert.equal(hatch.createdBy.username, client.account.username);
  assert.equal(hatch.state, "open");
  assert.equal(hatch.status, "New Hatch");
});

test("open hatches are visible to everyone", async () => {
  const client = await signup();
  const hatch = await createHatch(client.token);
  const list = await api("GET", "/api/hatches");
  assert.equal(list.status, 200);
  assert.ok(list.body.hatches.some((item) => item.id === hatch.id));
});

test("claiming: one winner, no self-claims, no double claims", async () => {
  const client = await signup();
  const hatcher = await signup();
  const bystander = await signup();
  const hatch = await createHatch(client.token);

  const selfClaim = await api("POST", `/api/hatches/${hatch.id}/claim`, { token: client.token });
  assert.equal(selfClaim.status, 403);

  const claim = await api("POST", `/api/hatches/${hatch.id}/claim`, { token: hatcher.token });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.hatch.state, "claimed");
  assert.equal(claim.body.hatch.status, "Incubating");
  assert.equal(claim.body.hatch.claimedBy.username, hatcher.account.username);

  const secondClaim = await api("POST", `/api/hatches/${hatch.id}/claim`, { token: bystander.token });
  assert.equal(secondClaim.status, 409);
});

test("simultaneous claims: exactly one succeeds", async () => {
  const client = await signup();
  const hatch = await createHatch(client.token, { title: "Race me" });
  const claimers = await Promise.all(Array.from({ length: 12 }, () => signup()));

  const results = await Promise.all(
    claimers.map((claimer) => api("POST", `/api/hatches/${hatch.id}/claim`, { token: claimer.token }))
  );

  const winners = results.filter((result) => result.status === 200);
  const losers = results.filter((result) => result.status === 409);
  assert.equal(winners.length, 1, `expected exactly one winner, got ${winners.length}`);
  assert.equal(losers.length, claimers.length - 1);

  const detail = await api("GET", `/api/hatches/${hatch.id}`);
  assert.equal(detail.body.hatch.claimedBy.username, winners[0].body.hatch.claimedBy.username);
});

test("full lifecycle: claim, start, submit, reject, resubmit, approve", async () => {
  const client = await signup();
  const hatcher = await signup();
  const hatch = await createHatch(client.token);

  await api("POST", `/api/hatches/${hatch.id}/claim`, { token: hatcher.token });

  const start = await api("POST", `/api/hatches/${hatch.id}/start`, { token: hatcher.token });
  assert.equal(start.body.hatch.state, "in_progress");

  const submitByClient = await api("POST", `/api/hatches/${hatch.id}/submit`, {
    token: client.token,
    body: { message: "not my job" },
  });
  assert.equal(submitByClient.status, 403);

  const submit = await api("POST", `/api/hatches/${hatch.id}/submit`, {
    token: hatcher.token,
    body: { message: "First draft attached", attachments: [{ name: "menu.pdf" }] },
  });
  assert.equal(submit.body.hatch.state, "submitted");

  const reviewByHatcher = await api("POST", `/api/hatches/${hatch.id}/review`, {
    token: hatcher.token,
    body: { decision: "approve" },
  });
  assert.equal(reviewByHatcher.status, 403);

  const reject = await api("POST", `/api/hatches/${hatch.id}/review`, {
    token: client.token,
    body: { decision: "reject", feedback: "Please use the brand colors" },
  });
  assert.equal(reject.body.hatch.state, "in_progress");

  const resubmit = await api("POST", `/api/hatches/${hatch.id}/submit`, {
    token: hatcher.token,
    body: { message: "Updated with brand colors" },
  });
  assert.equal(resubmit.body.hatch.state, "submitted");

  const approve = await api("POST", `/api/hatches/${hatch.id}/review`, {
    token: client.token,
    body: { decision: "approve" },
  });
  assert.equal(approve.body.hatch.state, "completed");
  assert.equal(approve.body.hatch.status, "Hatched");
  assert.ok(approve.body.hatch.completedAt);

  const lateClaim = await api("POST", `/api/hatches/${hatch.id}/claim`, { token: hatcher.token });
  assert.equal(lateClaim.status, 409);

  const detail = await api("GET", `/api/hatches/${hatch.id}`, { token: client.token });
  const transitions = detail.body.events.map((event) => event.to);
  assert.deepEqual(transitions, [
    "open", "claimed", "in_progress", "submitted", "in_progress", "submitted", "completed",
  ]);
  assert.equal(detail.body.submissions.length, 2);
  assert.equal(detail.body.submissions[0].status, "rejected");
  assert.equal(detail.body.submissions[0].feedback, "Please use the brand colors");
  assert.equal(detail.body.submissions[1].status, "approved");
});

test("cancel and dispute rules", async () => {
  const client = await signup();
  const hatcher = await signup();
  const stranger = await signup();

  const cancellable = await createHatch(client.token);
  const cancelByStranger = await api("POST", `/api/hatches/${cancellable.id}/cancel`, { token: stranger.token });
  assert.equal(cancelByStranger.status, 403);
  const cancel = await api("POST", `/api/hatches/${cancellable.id}/cancel`, { token: client.token });
  assert.equal(cancel.body.hatch.state, "cancelled");
  const claimCancelled = await api("POST", `/api/hatches/${cancellable.id}/claim`, { token: hatcher.token });
  assert.equal(claimCancelled.status, 409);

  const disputable = await createHatch(client.token);
  await api("POST", `/api/hatches/${disputable.id}/claim`, { token: hatcher.token });
  await api("POST", `/api/hatches/${disputable.id}/submit`, { token: hatcher.token, body: { message: "Done" } });
  const disputeByStranger = await api("POST", `/api/hatches/${disputable.id}/dispute`, { token: stranger.token });
  assert.equal(disputeByStranger.status, 403);
  const dispute = await api("POST", `/api/hatches/${disputable.id}/dispute`, {
    token: client.token,
    body: { note: "Deliverable does not match the brief" },
  });
  assert.equal(dispute.body.hatch.state, "disputed");
  assert.equal(dispute.body.hatch.status, "Disputed");
});

test("messaging: welcome message, hatch system updates, direct threads, read/unread, archive", async () => {
  const client = await signup();
  const hatcher = await signup();

  // Signup dropped a system welcome message into a system conversation.
  const welcomeList = await api("GET", "/api/messages/conversations", { token: client.token });
  assert.equal(welcomeList.status, 200);
  const welcome = welcomeList.body.conversations.find((item) => item.kind === "system" && !item.hatchId);
  assert.ok(welcome, "expected a system welcome conversation");
  assert.match(welcome.lastMessage.body, /Welcome to Hatch/);
  assert.equal(welcome.unreadCount, 1);
  assert.ok(welcomeList.body.unreadCount >= 1);

  // Claiming a hatch sends the client a system message tied to that hatch.
  const hatch = await createHatch(client.token);
  await api("POST", `/api/hatches/${hatch.id}/claim`, { token: hatcher.token });
  const afterClaim = await api("GET", "/api/messages/conversations", { token: client.token });
  const hatchThread = afterClaim.body.conversations.find((item) => item.kind === "system" && item.hatchId === hatch.id);
  assert.ok(hatchThread, "expected a per-hatch system conversation");
  assert.equal(hatchThread.hatchTitle, hatch.title);
  assert.match(hatchThread.lastMessage.body, /claimed your Hatch/);

  // System conversations refuse replies.
  const replyToSystem = await api("POST", `/api/messages/conversations/${hatchThread.id}`, {
    token: client.token,
    body: { body: "hello?" },
  });
  assert.equal(replyToSystem.status, 403);

  // The client starts the hatch's direct thread without naming the Hatcher —
  // the server resolves the counterpart from the hatch.
  const started = await api("POST", "/api/messages/start", {
    token: client.token,
    body: { hatchId: hatch.id, body: "Hi! Excited to see what you build." },
  });
  assert.equal(started.status, 201);
  const direct = started.body.conversation;
  assert.equal(direct.kind, "direct");
  assert.equal(direct.hatchId, hatch.id);
  assert.equal(direct.participants[0].username, hatcher.account.username);

  // Starting again reuses the same conversation instead of forking a new one.
  const startedAgain = await api("POST", "/api/messages/start", {
    token: client.token,
    body: { hatchId: hatch.id, body: "One more thing — brand colors are green." },
  });
  assert.equal(startedAgain.body.conversation.id, direct.id);

  // The Hatcher sees 2 unread in that thread, reads them, replies.
  const hatcherList = await api("GET", "/api/messages/conversations", { token: hatcher.token });
  const hatcherView = hatcherList.body.conversations.find((item) => item.id === direct.id);
  assert.equal(hatcherView.unreadCount, 2);
  const thread = await api("GET", `/api/messages/conversations/${direct.id}`, { token: hatcher.token });
  assert.equal(thread.body.messages.length, 2);
  assert.equal(thread.body.messages[0].fromMe, false);
  assert.equal(thread.body.messages[0].sender.username, client.account.username);
  await api("POST", `/api/messages/conversations/${direct.id}/read`, { token: hatcher.token });
  const afterRead = await api("GET", "/api/messages/conversations", { token: hatcher.token });
  assert.equal(afterRead.body.conversations.find((item) => item.id === direct.id).unreadCount, 0);
  const reply = await api("POST", `/api/messages/conversations/${direct.id}`, {
    token: hatcher.token,
    body: { body: "Sounds good — green it is." },
  });
  assert.equal(reply.status, 201);

  // A stranger can neither read nor post into the thread.
  const stranger = await signup();
  const strangerRead = await api("GET", `/api/messages/conversations/${direct.id}`, { token: stranger.token });
  assert.equal(strangerRead.status, 404);
  const strangerPost = await api("POST", `/api/messages/conversations/${direct.id}`, {
    token: stranger.token,
    body: { body: "let me in" },
  });
  assert.equal(strangerPost.status, 404);

  // General (non-hatch) messaging by username is its own conversation.
  const general = await api("POST", "/api/messages/start", {
    token: hatcher.token,
    body: { to: client.account.username, body: "Unrelated: what AI tools do you use?" },
  });
  assert.equal(general.status, 201);
  assert.notEqual(general.body.conversation.id, direct.id);
  assert.equal(general.body.conversation.hatchId, null);

  // Archive hides it from the unread total; a new message un-archives it.
  const unreadBefore = await api("GET", "/api/messages/unread-count", { token: client.token });
  await api("POST", `/api/messages/conversations/${general.body.conversation.id}/archive`, { token: client.token });
  const unreadAfter = await api("GET", "/api/messages/unread-count", { token: client.token });
  assert.equal(unreadAfter.body.unreadCount, unreadBefore.body.unreadCount - 1);
  await api("POST", `/api/messages/conversations/${general.body.conversation.id}`, {
    token: hatcher.token,
    body: { body: "ping" },
  });
  const clientList = await api("GET", "/api/messages/conversations", { token: client.token });
  const generalView = clientList.body.conversations.find((item) => item.id === general.body.conversation.id);
  assert.equal(generalView.archived, false);

  // Empty and oversized messages are rejected.
  const empty = await api("POST", `/api/messages/conversations/${direct.id}`, {
    token: client.token,
    body: { body: "   " },
  });
  assert.equal(empty.status, 400);
  const huge = await api("POST", `/api/messages/conversations/${direct.id}`, {
    token: client.token,
    body: { body: "x".repeat(5001) },
  });
  assert.equal(huge.status, 400);
});

test("messaging hardening: no email lookup, no hatch-tag spoofing, sending un-archives for the sender", async () => {
  const alice = await signup();
  const bob = await signup();
  const stranger = await signup();

  // Recipients resolve by username only — an email must not map to an identity.
  const byEmail = await api("POST", "/api/messages/start", {
    token: stranger.token,
    body: { to: bob.account.email, body: "probing" },
  });
  assert.equal(byEmail.status, 404);

  // A hatch context can only be attached when one side is on the hatch.
  const hatch = await createHatch(alice.token);
  const spoofed = await api("POST", "/api/messages/start", {
    token: stranger.token,
    body: { to: bob.account.username, hatchId: hatch.id, body: "official-looking scam" },
  });
  assert.equal(spoofed.status, 403);
  // ...but messaging the hatch's poster about their hatch stays allowed.
  const legit = await api("POST", "/api/messages/start", {
    token: stranger.token,
    body: { to: alice.account.username, hatchId: hatch.id, body: "Question before I claim this" },
  });
  assert.equal(legit.status, 201);

  // Sending into a thread you archived brings it back for you too.
  await api("POST", `/api/messages/conversations/${legit.body.conversation.id}/archive`, { token: stranger.token });
  const resent = await api("POST", `/api/messages/conversations/${legit.body.conversation.id}`, {
    token: stranger.token,
    body: { body: "One more question" },
  });
  assert.equal(resent.status, 201);
  assert.equal(resent.body.conversation.archived, false);
  const list = await api("GET", "/api/messages/conversations", { token: stranger.token });
  assert.equal(list.body.conversations.find((c) => c.id === legit.body.conversation.id).archived, false);
});

test("busy threads keep showing the newest messages (500-cap truncates the old end)", async () => {
  const alice = await signup();
  const bob = await signup();
  const started = await api("POST", "/api/messages/start", {
    token: alice.token,
    body: { to: bob.account.username, body: "msg 0" },
  });
  const id = started.body.conversation.id;

  // 509 more messages in parallel batches (the server serializes writes).
  for (let batch = 0; batch < 6; batch += 1) {
    await Promise.all(Array.from({ length: 85 }, (_, i) =>
      api("POST", `/api/messages/conversations/${id}`, {
        token: alice.token,
        body: { body: `bulk ${batch * 85 + i + 1}` },
      })));
  }
  const final = await api("POST", `/api/messages/conversations/${id}`, {
    token: alice.token,
    body: { body: "the newest message" },
  });
  assert.equal(final.status, 201);

  const thread = await api("GET", `/api/messages/conversations/${id}`, { token: bob.token });
  assert.equal(thread.body.messages.length, 500);
  assert.equal(thread.body.messages[thread.body.messages.length - 1].body, "the newest message");
});

test("admin hatch deletion notifies via a replyable direct message with the hatch named", async () => {
  // The admin allowlist for tests is set via HATCH_ADMIN_EMAILS in before().
  const admin = await signup({ username: "admin_msg", email: "admin@test.local" });
  const client = await signup();
  const hatch = await createHatch(client.token, { title: "Doomed hatch" });

  const deleted = await api("DELETE", `/api/hatches/${hatch.id}`, { token: admin.token });
  assert.equal(deleted.status, 200);

  const list = await api("GET", "/api/messages/conversations", { token: client.token });
  const notice = list.body.conversations.find((c) => c.kind === "direct"
    && c.participants.some((p) => p.username === "admin_msg"));
  assert.ok(notice, "expected a direct conversation from the admin");
  assert.match(notice.lastMessage.body, /Doomed hatch/);

  // And the recipient can actually reply, as the notice invites.
  const reply = await api("POST", `/api/messages/conversations/${notice.id}`, {
    token: client.token,
    body: { body: "That was a mistake — please restore it." },
  });
  assert.equal(reply.status, 201);
});

test("profile: avatar upload, validation, and name change", async () => {
  const user = await signup();
  const avatar = `data:image/png;base64,${"a".repeat(120)}`;

  const updated = await api("POST", "/api/auth/profile", {
    token: user.token,
    body: { name: "New Display Name", avatarData: avatar },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.account.name, "New Display Name");
  assert.equal(updated.body.account.avatar, avatar);

  const me = await api("GET", "/api/auth/me", { token: user.token });
  assert.equal(me.body.account.avatar, avatar);

  const notImage = await api("POST", "/api/auth/profile", {
    token: user.token,
    body: { avatarData: "data:text/html,<script>alert(1)</script>" },
  });
  assert.equal(notImage.status, 400);

  const removed = await api("POST", "/api/auth/profile", {
    token: user.token,
    body: { removeAvatar: true },
  });
  assert.equal(removed.body.account.avatar, "");

  // The avatar travels with messages so threads can render it.
  const friend = await signup();
  await api("POST", "/api/auth/profile", { token: user.token, body: { avatarData: avatar } });
  const started = await api("POST", "/api/messages/start", {
    token: user.token,
    body: { to: friend.account.username, body: "avatar check" },
  });
  const thread = await api("GET", `/api/messages/conversations/${started.body.conversation.id}`, { token: friend.token });
  assert.equal(thread.body.messages[0].sender.avatar, avatar);
  const list = await api("GET", "/api/messages/conversations", { token: friend.token });
  const view = list.body.conversations.find((item) => item.id === started.body.conversation.id);
  assert.equal(view.participants[0].avatar, avatar);
});

test("static server refuses dotfiles and the database directory", async () => {
  for (const forbidden of ["/.env.local", "/.env.example", "/data/hatch.db"]) {
    const response = await fetch(`${BASE}${forbidden}`);
    assert.equal(response.status, 403, `${forbidden} should be forbidden`);
  }
  const page = await fetch(`${BASE}/`);
  assert.equal(page.status, 200);
});
