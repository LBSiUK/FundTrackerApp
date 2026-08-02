'use strict';

// Runs once at startup: migrate anything left over from the JSON era, then make
// sure an admin exists.
//
// Both steps are idempotent. Migration is skipped if the database already has
// accounts, and the JSON files are renamed to `.migrated` afterwards so a later
// restart can't replay them.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, transaction, DATA_DIR } = require('./db');
const accounts = require('./accounts');

const ADMIN_USERNAME = 'admin';
const ADMIN_DEFAULT_PASSWORD = 'defaultadmin';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return null;
  }
}

function retire(file) {
  const from = path.join(DATA_DIR, file);
  if (fs.existsSync(from)) {
    try {
      fs.renameSync(from, `${from}.migrated`);
    } catch {
      // Not fatal — migration is guarded by the account count either way.
    }
  }
}

/**
 * Brings users.json / devices.json / invites.json / snapshot.json into the
 * database. Old accounts arrive as ordinary users: the dedicated admin below is
 * a separate account, not a promotion of an existing one.
 */
function migrateFromJson(log) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM accounts').get();
  if (n > 0) return false;

  const users = readJson('users.json');
  if (!users || Object.keys(users).length === 0) return false;

  const snapshot = readJson('snapshot.json');
  const oldDevices = readJson('devices.json') || {};
  const oldInvites = readJson('invites.json') || {};

  transaction(() => {
    const idByName = new Map();

    for (const [username, record] of Object.entries(users)) {
      // The hash carries over as-is, so nobody's password changes.
      const info = db.prepare(`
        INSERT INTO accounts (username, password_hash, role, active, must_change_password, created_at)
        VALUES (?, ?, 'user', ?, 0, ?)
      `).run(
        username.toLowerCase(),
        record.password,
        record.active === false ? 0 : 1,
        record.createdAt || new Date().toISOString()
      );
      idByName.set(username.toLowerCase(), Number(info.lastInsertRowid));
    }

    for (const device of Object.values(oldDevices)) {
      const accountId = idByName.get(String(device.user || '').toLowerCase());
      if (!accountId) continue;
      db.prepare(`
        INSERT INTO devices (id, account_id, name, token_hash, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        device.id,
        accountId,
        device.name || 'iPhone',
        // Was stored base64; the column is hex now.
        Buffer.from(device.tokenHash, 'base64').toString('hex'),
        device.createdAt || new Date().toISOString(),
        device.lastSeenAt || null
      );
    }

    for (const invite of Object.values(oldInvites)) {
      db.prepare(`
        INSERT INTO invites (id, code_hash, created_by, note, created_at, expires_at, used_at, used_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invite.id,
        invite.hash,
        idByName.get(String(invite.createdBy || '').toLowerCase()) || null,
        invite.note || '',
        invite.createdAt,
        invite.expiresAt,
        invite.usedAt || null,
        idByName.get(String(invite.usedBy || '').toLowerCase()) || null
      );
    }

    // The single server-wide snapshot belonged to whoever was using it — with
    // one account that's unambiguous, and with several there is no way to tell,
    // so it goes to the oldest account rather than being silently duplicated.
    if (snapshot && (snapshot.devices || snapshot.sales)) {
      const owner = [...idByName.values()].sort((a, b) => a - b)[0];
      if (owner) {
        db.prepare(`
          INSERT INTO snapshots (account_id, synced_at, payload) VALUES (?, ?, ?)
          ON CONFLICT(account_id) DO NOTHING
        `).run(
          owner,
          snapshot.syncedAt || new Date().toISOString(),
          JSON.stringify({ devices: snapshot.devices || [], sales: snapshot.sales || [] })
        );

        // Adopt any photo files already on disk for that same account.
        const photosDir = path.join(DATA_DIR, 'photos');
        const referenced = (snapshot.devices || []).map((d) => d.photoHash).filter(Boolean);
        for (const hash of referenced) {
          const file = path.join(photosDir, `${hash}.jpg`);
          if (!fs.existsSync(file)) continue;
          db.prepare(`
            INSERT INTO photos (account_id, hash, bytes, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(account_id, hash) DO NOTHING
          `).run(owner, hash, fs.statSync(file).size, new Date().toISOString());
        }
      }
    }
  });

  for (const file of ['users.json', 'devices.json', 'invites.json', 'snapshot.json']) retire(file);

  log(`Migrated ${Object.keys(users).length} account(s) from JSON into ${path.join(DATA_DIR, 'fundtracker.db')}.`);
  log('The old .json files were renamed to .migrated — delete them once happy.');
  return true;
}

/**
 * Guarantees a usable admin.
 *
 * The default password is a published constant, which is only acceptable
 * because the account is created with must_change_password set: it can sign in
 * and do nothing else until the password is replaced. Anyone standing this
 * server up on the public internet should change it immediately.
 */
function ensureAdmin(log) {
  const existing = accounts.byUsername(ADMIN_USERNAME);

  if (!existing) {
    accounts.create({
      username: ADMIN_USERNAME,
      password: ADMIN_DEFAULT_PASSWORD,
      role: 'admin',
      active: true,
      mustChangePassword: true,
    });
    log(`Created the "${ADMIN_USERNAME}" account with the default password.`);
    log('It must be changed at first sign-in before anything else works.');
    return;
  }

  // Never silently re-enable or reset an admin that already exists — that would
  // turn a restart into a way to reinstate the default password.
  if (accounts.countAdmins() === 0) {
    accounts.setActive(existing.id, true);
    accounts.setRole(existing.id, 'admin');
    log(`Re-enabled "${ADMIN_USERNAME}" because no active admin remained.`);
  }
}

function run({ log = console.log } = {}) {
  migrateFromJson(log);
  ensureAdmin(log);
}

module.exports = { run, ADMIN_USERNAME, ADMIN_DEFAULT_PASSWORD };
