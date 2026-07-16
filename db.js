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
    role TEXT NOT NULL DEFAULT 'Client and Hatcher',
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

  -- Per-user inbox: admin notices, client/hatcher updates, system events.
  -- hatch_id is intentionally not a foreign key so messages survive an
  -- admin deleting the hatch they refer to.
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
