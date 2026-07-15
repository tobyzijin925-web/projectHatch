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

test("static server refuses dotfiles and the database directory", async () => {
  for (const forbidden of ["/.env.local", "/.env.example", "/data/hatch.db"]) {
    const response = await fetch(`${BASE}${forbidden}`);
    assert.equal(response.status, 403, `${forbidden} should be forbidden`);
  }
  const page = await fetch(`${BASE}/`);
  assert.equal(page.status, 200);
});
