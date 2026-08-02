'use strict';

// Per-device sync tokens, owned by an account id.
//
// A device token is what the iOS app stores after signing in. The password is
// exchanged for one of these once and never kept on the phone. One account can
// have many devices; revoking one leaves the others alone.
//
// Tokens are hashed with plain SHA-256 rather than scrypt. That's deliberate:
// a token is 32 bytes of CSPRNG output, so there's no dictionary to attack and
// no work factor worth paying. Passwords need scrypt because humans choose them.

const crypto = require('crypto');
const { db } = require('./db');

const TOKEN_BYTES = 32;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function present(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    username: row.username,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Mints a token and stores only its hash. The raw value is returned once. */
function issue(accountId, deviceName) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const id = crypto.randomUUID();
  const name = String(deviceName || 'iPhone').slice(0, 60);

  db.prepare(`
    INSERT INTO devices (id, account_id, name, token_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, accountId, name, hashToken(token), new Date().toISOString());

  return { token, id, name };
}

/**
 * Resolves a raw token to its device and account.
 * Looks up by hash rather than scanning, so this stays constant-work as the
 * number of devices grows — the hash of a wrong token simply matches no row.
 */
function verify(token) {
  if (!token) return null;

  const row = db.prepare(`
    SELECT d.*, a.username, a.active AS account_active, a.role AS account_role
    FROM devices d
    JOIN accounts a ON a.id = d.account_id
    WHERE d.token_hash = ?
  `).get(hashToken(token));

  if (!row || row.account_active !== 1) return null;
  return present(row);
}

/** Best-effort last-seen stamp; never fails a sync. */
function touch(id) {
  try {
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  } catch {
    // A timestamp isn't worth rejecting a sync over.
  }
}

function listForAccount(accountId) {
  return db.prepare(`
    SELECT d.*, a.username FROM devices d
    JOIN accounts a ON a.id = d.account_id
    WHERE d.account_id = ?
    ORDER BY d.created_at DESC
  `).all(accountId).map(present);
}

function byId(id) {
  return present(db.prepare(`
    SELECT d.*, a.username FROM devices d
    JOIN accounts a ON a.id = d.account_id
    WHERE d.id = ?
  `).get(id));
}

function revoke(id) {
  return db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes > 0;
}

function revokeAllForAccount(accountId) {
  return db.prepare('DELETE FROM devices WHERE account_id = ?').run(accountId).changes;
}

function countForAccount(accountId) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE account_id = ?').get(accountId);
  return n;
}

module.exports = {
  issue,
  verify,
  touch,
  listForAccount,
  byId,
  revoke,
  revokeAllForAccount,
  countForAccount,
};
