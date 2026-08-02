'use strict';

// The database.
//
// This was a set of JSON files until accounts needed identity independent of
// their name. Renaming a user meant rewriting the key every other file pointed
// at, and there was no way to ask "whose devices are these?" without loading
// everything. Both are relational problems, so this is now SQLite.
//
// `node:sqlite` is built into Node, so there's no native module to compile and
// the Alpine image needs no build toolchain.
//
// The shape that matters: **everything hangs off `accounts.id`, never off a
// username.** Usernames are just a unique label that can change at any time.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.FUNDTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'fundtracker.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL lets reads continue during a write, and is the sane default for a
// long-running server. Foreign keys are off by default in SQLite — without
// this, every ON DELETE CASCADE below would silently do nothing.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    username              TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    password_hash         TEXT    NOT NULL,
    role                  TEXT    NOT NULL DEFAULT 'user',
    active                INTEGER NOT NULL DEFAULT 1,
    must_change_password  INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT    NOT NULL,
    last_login_at         TEXT
  );

  CREATE TABLE IF NOT EXISTS devices (
    id            TEXT    PRIMARY KEY,
    account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    token_hash    TEXT    NOT NULL UNIQUE,
    created_at    TEXT    NOT NULL,
    last_seen_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS invites (
    id          TEXT    PRIMARY KEY,
    code_hash   TEXT    NOT NULL UNIQUE,
    created_by  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    note        TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    used_at     TEXT,
    used_by     INTEGER REFERENCES accounts(id) ON DELETE SET NULL
  );

  -- One snapshot per account. Previously there was one for the whole server,
  -- which meant a second user would have silently overwritten the first.
  CREATE TABLE IF NOT EXISTS snapshots (
    account_id  INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    synced_at   TEXT    NOT NULL,
    payload     TEXT    NOT NULL
  );

  -- Photo bytes stay content-addressed on disk and shared, but ownership is
  -- per account: two accounts with the same photo store one file and two rows,
  -- and neither can read a photo it doesn't have a row for.
  CREATE TABLE IF NOT EXISTS photos (
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    hash        TEXT    NOT NULL,
    bytes       INTEGER NOT NULL,
    created_at  TEXT    NOT NULL,
    PRIMARY KEY (account_id, hash)
  );

  CREATE INDEX IF NOT EXISTS idx_devices_account ON devices(account_id);
  CREATE INDEX IF NOT EXISTS idx_devices_token   ON devices(token_hash);
  CREATE INDEX IF NOT EXISTS idx_invites_code    ON invites(code_hash);
  CREATE INDEX IF NOT EXISTS idx_invites_used    ON invites(used_at);
  CREATE INDEX IF NOT EXISTS idx_photos_hash     ON photos(hash);
`);

/** Runs `fn` in a transaction, rolling back if it throws. */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, transaction, DB_PATH, DATA_DIR };
