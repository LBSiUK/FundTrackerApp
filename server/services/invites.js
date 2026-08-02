'use strict';

// One-time account activation codes.
//
// Registration is closed: you cannot create an account on this server without a
// code an admin generated. That's what keeps a publicly reachable server from
// being an open sign-up.
//
// Codes read as `ABCD-EFGH-JKMN` — 12 symbols from a Crockford-style alphabet
// with I, L, O and U removed, so nothing is ambiguous typed off a screen. 60
// bits of entropy, single use, expiring. Only the SHA-256 is stored, so a
// leaked database yields nothing usable.

const crypto = require('crypto');
const { db } = require('./db');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 3;
const GROUP_SIZE = 4;
const DEFAULT_EXPIRY_DAYS = 14;

/** Uppercases and strips separators, so lower case or missing dashes still work. */
function canonical(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(canonical(code)).digest('hex');
}

function generateCode() {
  const symbols = [];
  // randomInt avoids the modulo bias a naive randomBytes % 32 would introduce.
  for (let i = 0; i < GROUPS * GROUP_SIZE; i += 1) {
    symbols.push(ALPHABET[crypto.randomInt(ALPHABET.length)]);
  }
  const chunks = [];
  for (let i = 0; i < GROUPS; i += 1) {
    chunks.push(symbols.slice(i * GROUP_SIZE, (i + 1) * GROUP_SIZE).join(''));
  }
  return chunks.join('-');
}

function statusOf(row) {
  if (row.used_at) return 'used';
  if (new Date(row.expires_at) < new Date()) return 'expired';
  return 'active';
}

function present(row) {
  return {
    id: row.id,
    note: row.note,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdByName: row.created_by_name || null,
    usedByName: row.used_by_name || null,
    status: statusOf(row),
  };
}

/** Creates a code. The plaintext is returned once and isn't recoverable. */
function issue({ createdBy, expiresInDays = DEFAULT_EXPIRY_DAYS, note = '' } = {}) {
  const code = generateCode();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();

  db.prepare(`
    INSERT INTO invites (id, code_hash, created_by, note, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, hashCode(code), createdBy || null, String(note || '').slice(0, 120), new Date().toISOString(), expiresAt);

  return { code, id, expiresAt };
}

/**
 * Checks a code and marks it used in the same statement.
 *
 * The UPDATE ... WHERE used_at IS NULL is the whole point: two registrations
 * racing on one code produce one row change and one winner. Checking first and
 * marking later is how a code gets redeemed twice.
 */
function consume(code, accountId) {
  if (canonical(code).length !== GROUPS * GROUP_SIZE) return { ok: false, reason: 'invalid' };

  const row = db.prepare('SELECT * FROM invites WHERE code_hash = ?').get(hashCode(code));
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' };

  const changed = db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL')
    .run(new Date().toISOString(), accountId || null, row.id).changes;

  if (changed === 0) return { ok: false, reason: 'used' };
  return { ok: true, id: row.id };
}

function list({ limit = 100, offset = 0 } = {}) {
  const rows = db.prepare(`
    SELECT i.*, c.username AS created_by_name, u.username AS used_by_name
    FROM invites i
    LEFT JOIN accounts c ON c.id = i.created_by
    LEFT JOIN accounts u ON u.id = i.used_by
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const { total } = db.prepare('SELECT COUNT(*) AS total FROM invites').get();
  return { invites: rows.map(present), total, limit, offset };
}

function revoke(id) {
  return db.prepare('DELETE FROM invites WHERE id = ?').run(id).changes > 0;
}

/** Drops used and expired codes. Housekeeping only. */
function purgeSpent() {
  return db.prepare("DELETE FROM invites WHERE used_at IS NOT NULL OR expires_at < ?")
    .run(new Date().toISOString()).changes;
}

module.exports = { issue, consume, list, revoke, purgeSpent };
