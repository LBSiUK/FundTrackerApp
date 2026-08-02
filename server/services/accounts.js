'use strict';

// Accounts.
//
// Every other table points at `accounts.id`, never at a username, so renaming
// an account is a single UPDATE and breaks nothing. Sessions carry the id too,
// which is why a rename doesn't sign anyone out.

const crypto = require('crypto');
const { db } = require('./db');

// scrypt parameters. N is the work factor — the dominant cost. Fast enough for
// a login, expensive enough that a stolen database is not a password list.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const MIN_PASSWORD = 12;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * SCRYPT.N * SCRYPT.r,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  let derived;
  try {
    derived = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * Number(N) * Number(r),
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/** Strips the hash. Nothing outside this file should ever see it. */
function present(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    active: row.active === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function normaliseName(name) {
  return String(name || '').trim().toLowerCase();
}

function byId(id) {
  return present(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
}

function byUsername(username) {
  return present(db.prepare('SELECT * FROM accounts WHERE username = ?').get(normaliseName(username)));
}

function create({ username, password, role = 'user', active = true, mustChangePassword = false }) {
  const name = normaliseName(username);
  const info = db.prepare(`
    INSERT INTO accounts (username, password_hash, role, active, must_change_password, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name,
    hashPassword(password),
    role === 'admin' ? 'admin' : 'user',
    active ? 1 : 0,
    mustChangePassword ? 1 : 0,
    new Date().toISOString()
  );

  return byId(info.lastInsertRowid);
}

/**
 * The one reason this module exists in its current shape: a rename touches a
 * single column and every device, invite, snapshot and photo follows along
 * because they reference the id.
 */
function rename(id, username) {
  const name = normaliseName(username);
  if (!name) return { ok: false, reason: 'empty' };

  const clash = db.prepare('SELECT id FROM accounts WHERE username = ? AND id != ?').get(name, id);
  if (clash) return { ok: false, reason: 'taken' };

  db.prepare('UPDATE accounts SET username = ? WHERE id = ?').run(name, id);
  return { ok: true, account: byId(id) };
}

function setPassword(id, password, { mustChange = false } = {}) {
  db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = ? WHERE id = ?')
    .run(hashPassword(password), mustChange ? 1 : 0, id);
  return byId(id);
}

function setRole(id, role) {
  db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'user', id);
  return byId(id);
}

function setActive(id, active) {
  db.prepare('UPDATE accounts SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return byId(id);
}

function remove(id) {
  // Devices, snapshots and photo rows go with it via ON DELETE CASCADE.
  return db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
}

/**
 * Paged deliberately: this is built for a server with many accounts, and an
 * admin page that loads every row would stop working long before the database
 * did.
 */
function list({ search = '', limit = 50, offset = 0 } = {}) {
  const term = `%${String(search || '').trim().toLowerCase()}%`;

  const rows = db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM devices d WHERE d.account_id = a.id) AS device_count
    FROM accounts a
    WHERE a.username LIKE ?
    ORDER BY a.username
    LIMIT ? OFFSET ?
  `).all(term, limit, offset);

  const { total } = db.prepare('SELECT COUNT(*) AS total FROM accounts WHERE username LIKE ?').get(term);

  return {
    accounts: rows.map((row) => ({ ...present(row), deviceCount: row.device_count })),
    total,
    limit,
    offset,
  };
}

function countAdmins() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND active = 1").get();
  return n;
}

function count() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM accounts').get();
  return n;
}

// A derivation always runs, even for an unknown username, so response timing
// doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(32).toString('hex'));

/** Returns the account on success, or null. Disabled accounts never succeed. */
function authenticate(username, password) {
  const row = db.prepare('SELECT * FROM accounts WHERE username = ?').get(normaliseName(username));
  const ok = verifyPassword(String(password || ''), row ? row.password_hash : DUMMY_HASH);
  if (!ok || !row || row.active !== 1) return null;

  db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return present(row);
}

module.exports = {
  byId,
  byUsername,
  create,
  rename,
  setPassword,
  setRole,
  setActive,
  remove,
  list,
  count,
  countAdmins,
  authenticate,
  hashPassword,
  verifyPassword,
  normaliseName,
  MIN_PASSWORD,
};
