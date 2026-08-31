// Server-side only. SQLite storage for the Hatch sync backend.
// Uses Node's built-in node:sqlite so the project stays dependency-free.

"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const defaultDir = path.join(__dirname, "data");
const dbPath = process.env.HATCH_DB_PATH || path.join(defaultDir, "hatch.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Client and Operator',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    joined_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS hatch_states (
    name TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS hatch_allowed_transitions (
    from_state TEXT NOT NULL REFERENCES hatch_states(name),
    to_state TEXT NOT NULL REFERENCES hatch_states(name),
    PRIMARY KEY (from_state, to_state)
  );

  CREATE TABLE IF NOT EXISTS hatches (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    business TEXT NOT NULL DEFAULT 'Client',
    objective TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    budget TEXT NOT NULL DEFAULT 'Flexible',
    deadline TEXT NOT NULL DEFAULT 'Flexible',
    timeline TEXT NOT NULL DEFAULT 'Flexible',
    estimated_completion TEXT NOT NULL DEFAULT 'Flexible',
    industry TEXT NOT NULL DEFAULT 'General',
    category TEXT NOT NULL DEFAULT 'General',
    level TEXT NOT NULL DEFAULT 'L1',
    deliverables_json TEXT NOT NULL DEFAULT '[]',
    scope_json TEXT NOT NULL DEFAULT '[]',
    references_json TEXT NOT NULL DEFAULT '[]',
    constraints_json TEXT NOT NULL DEFAULT '[]',
    missing_info_json TEXT NOT NULL DEFAULT '[]',
    files_json TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT 'open' REFERENCES hatch_states(name),
    created_by INTEGER NOT NULL REFERENCES users(id),
    claimed_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_hatches_state ON hatches(state);
  CREATE INDEX IF NOT EXISTS idx_hatches_created_by ON hatches(created_by);
  CREATE INDEX IF NOT EXISTS idx_hatches_claimed_by ON hatches(claimed_by);

  CREATE TABLE IF NOT EXISTS hatch_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hatch_id TEXT NOT NULL REFERENCES hatches(id),
    from_state TEXT REFERENCES hatch_states(name),
    to_state TEXT NOT NULL REFERENCES hatch_states(name),
    actor_id INTEGER REFERENCES users(id),
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_hatch ON hatch_events(hatch_id);

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hatch_id TEXT NOT NULL REFERENCES hatches(id),
    submitted_by INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL DEFAULT '',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    feedback TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_submissions_hatch ON submissions(hatch_id);

  -- Hatcher applications reviewed by an admin (approve/reject).
  CREATE TABLE IF NOT EXISTS hatcher_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    background TEXT NOT NULL DEFAULT '',
    tools TEXT NOT NULL DEFAULT '',
    industries TEXT NOT NULL DEFAULT '',
    example_tasks TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    review_note TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    linkedin TEXT NOT NULL DEFAULT '',
    resume_name TEXT NOT NULL DEFAULT '',
    resume_data TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_applications_user ON hatcher_applications(user_id);
  CREATE INDEX IF NOT EXISTS idx_applications_status ON hatcher_applications(status);

  -- Legacy per-user inbox, superseded by the conversation tables below.
  -- Kept (read-only) so old rows survive; migrateLegacyInbox() copies them
  -- into system conversations once, then nothing writes here again.
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id INTEGER NOT NULL REFERENCES users(id),
    sender_id INTEGER REFERENCES users(id),
    kind TEXT NOT NULL DEFAULT 'system' CHECK (kind IN ('system', 'admin', 'client', 'hatcher')),
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    hatch_id TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, read_at);

  -- Messaging. A conversation is either 'direct' (two people) or 'system'
  -- (one person receiving updates from Hatch itself). hatch_id is
  -- intentionally not a foreign key so threads survive an admin deleting the
  -- hatch they refer to; hatch_title is snapshotted for the same reason.
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'system')),
    hatch_id TEXT,
    hatch_title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    archived_at TEXT,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);

  -- sender_id NULL = the Hatch system sender. read_at works because a
  -- message only ever has one recipient here: the other person in a direct
  -- conversation, or the sole participant of a system conversation.
  CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    sender_id INTEGER REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_conv_messages_conversation ON conversation_messages(conversation_id, id);
  CREATE INDEX IF NOT EXISTS idx_conv_messages_unread ON conversation_messages(conversation_id, read_at);

  -- One-off flags (e.g. "legacy inbox already migrated").
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Escrow/payout ledger. Rows are stubs until a payment provider is wired in
  -- via the onStateTransition hook in hatchApi.js.
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hatch_id TEXT NOT NULL REFERENCES hatches(id),
    kind TEXT NOT NULL CHECK (kind IN ('escrow_hold', 'escrow_release', 'refund')),
    amount_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'stub' CHECK (status IN ('stub', 'pending', 'settled', 'failed')),
    created_at TEXT NOT NULL
  );
`);

db.exec(`
  INSERT OR IGNORE INTO hatch_states (name) VALUES
    ('open'), ('claimed'), ('in_progress'), ('submitted'),
    ('completed'), ('disputed'), ('cancelled');

  INSERT OR IGNORE INTO hatch_allowed_transitions (from_state, to_state) VALUES
    ('open', 'claimed'),
    ('open', 'cancelled'),
    ('claimed', 'in_progress'),
    ('claimed', 'submitted'),
    ('claimed', 'cancelled'),
    ('in_progress', 'submitted'),
    ('in_progress', 'cancelled'),
    ('in_progress', 'disputed'),
    ('submitted', 'completed'),
    ('submitted', 'in_progress'),
    ('submitted', 'disputed'),
    ('disputed', 'completed'),
    ('disputed', 'cancelled');
`);

// Database-level guard: any writer, not just this API, is blocked from making
// a state jump that is not in hatch_allowed_transitions.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS hatch_state_guard
  BEFORE UPDATE OF state ON hatches
  WHEN OLD.state <> NEW.state
    AND NOT EXISTS (
      SELECT 1 FROM hatch_allowed_transitions
      WHERE from_state = OLD.state AND to_state = NEW.state
    )
  BEGIN
    SELECT RAISE(ABORT, 'invalid hatch state transition');
  END;
`);

// Adds columns to tables created by an earlier version of this file.
// CREATE TABLE IF NOT EXISTS won't alter an existing table, so bring older
// databases up to the current shape here. Each add is guarded so it's a no-op
// once applied.
function addColumnIfMissing(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing("hatcher_applications", "linkedin", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("hatcher_applications", "resume_name", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("hatcher_applications", "resume_data", "TEXT NOT NULL DEFAULT ''");
// Profile picture as a data: URL; empty = fall back to an initials avatar.
addColumnIfMissing("users", "avatar_data", "TEXT NOT NULL DEFAULT ''");
// Set once, permanently, the first time this account's email matches
// HATCH_ADMIN_EMAILS (see claimAdminIfEligible in hatchApi.js). Storing the
// grant on the row — instead of re-checking the email against the env var on
// every request — means admin status can't flicker if that env var is later
// edited, typo'd, or briefly unset during a redeploy.
addColumnIfMissing("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");

// One-time copy of the legacy notification inbox into system conversations,
// so nobody loses their message history when the messaging UI replaces the
// old profile inbox card. Each legacy row lands in the recipient's system
// conversation for the hatch it referenced (or their general one).
function migrateLegacyInbox() {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'legacy_inbox_migrated'").get();
  if (done) return;

  const legacy = db.prepare("SELECT * FROM messages ORDER BY id ASC").all();
  const findConversation = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants p ON p.conversation_id = c.id
    WHERE c.kind = 'system' AND p.user_id = ? AND c.hatch_id IS ?
  `);
  const insertConversation = db.prepare(
    "INSERT INTO conversations (kind, hatch_id, hatch_title, created_at, updated_at) VALUES ('system', ?, ?, ?, ?)",
  );
  const insertParticipant = db.prepare(
    "INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)",
  );
  const insertMessage = db.prepare(
    "INSERT INTO conversation_messages (conversation_id, sender_id, body, created_at, read_at) VALUES (?, NULL, ?, ?, ?)",
  );
  const touchConversation = db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?");
  const hatchTitle = db.prepare("SELECT title FROM hatches WHERE id = ?");

  db.exec("BEGIN IMMEDIATE");
  try {
    legacy.forEach((row) => {
      const hatchId = row.hatch_id || null;
      let conversation = findConversation.get(row.recipient_id, hatchId);
      if (!conversation) {
        const title = hatchId ? hatchTitle.get(hatchId)?.title || null : null;
        const created = insertConversation.run(hatchId, title, row.created_at, row.created_at);
        conversation = { id: Number(created.lastInsertRowid) };
        insertParticipant.run(conversation.id, row.recipient_id);
      }
      const body = [row.subject, row.body].filter(Boolean).join("\n");
      insertMessage.run(conversation.id, body || "(no message)", row.created_at, row.read_at);
      touchConversation.run(row.created_at, conversation.id);
    });
    db.prepare("INSERT INTO meta (key, value) VALUES ('legacy_inbox_migrated', ?)").run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // connection-level failure; original error matters more
    }
    throw error;
  }
}

migrateLegacyInbox();

function transact(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // connection-level failure; original error matters more
    }
    throw error;
  }
}

module.exports = { db, transact, dbPath };
