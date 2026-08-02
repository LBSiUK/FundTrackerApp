'use strict';

// One-time account activation codes.
//
// Registration is closed by default: you cannot create an account on this
// server without a code an admin generated. That's what keeps a publicly
// reachable sign-up form from becoming an open door.
//
// Codes are shown as `ABCD-EFGH-JKMN` — 12 symbols from a Crockford-style
// alphabet with I, L, O and U removed, so nothing reads ambiguously when typed
// off a screen into a phone. That's 60 bits of entropy, which is far past
// guessable, and the codes are single-use and expiring on top.
//
// Only the SHA-256 of a code is stored. A leaked invites.json therefore gives
// an attacker nothing usable, and the plaintext exists only in the response
// that created it.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FUNDTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
const INVITES_PATH = path.join(DATA_DIR, 'invites.json');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 3;
const GROUP_SIZE = 4;
const DEFAULT_EXPIRY_DAYS = 14;

/** Uppercases and strips separators, so typing lower case or spaces still works. */
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

function read() {
  try {
    return JSON.parse(fs.readFileSync(INVITES_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function write(invites) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${INVITES_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(invites, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, INVITES_PATH);
}

/**
 * Creates a code. The plaintext is returned once and is not recoverable —
 * losing it means generating another, which is cheap.
 */
function issue({ createdBy, expiresInDays = DEFAULT_EXPIRY_DAYS, note = '' } = {}) {
  const code = generateCode();
  const id = crypto.randomUUID();

  const invites = read();
  invites[id] = {
    id,
    hash: hashCode(code),
    createdBy: String(createdBy || '').toLowerCase(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
    note: String(note || '').slice(0, 120),
    usedAt: null,
    usedBy: null,
  };
  write(invites);

  return { code, id, expiresAt: invites[id].expiresAt };
}

function statusOf(record) {
  if (record.usedAt) return 'used';
  if (new Date(record.expiresAt) < new Date()) return 'expired';
  return 'active';
}

/**
 * Checks a code and, if good, marks it used in the same call.
 * Returns { ok: true } or { ok: false, reason }.
 *
 * Consuming and validating are deliberately one operation: leaving a gap
 * between "is this valid" and "mark it used" is how a code gets redeemed twice.
 */
function consume(code, username) {
  const supplied = hashCode(code);
  if (canonical(code).length !== GROUPS * GROUP_SIZE) {
    return { ok: false, reason: 'invalid' };
  }

  const invites = read();
  const match = Object.values(invites).find((record) => {
    const stored = Buffer.from(record.hash, 'hex');
    const given = Buffer.from(supplied, 'hex');
    return stored.length === given.length && crypto.timingSafeEqual(stored, given);
  });

  if (!match) return { ok: false, reason: 'invalid' };

  const status = statusOf(match);
  if (status === 'used') return { ok: false, reason: 'used' };
  if (status === 'expired') return { ok: false, reason: 'expired' };

  match.usedAt = new Date().toISOString();
  match.usedBy = String(username || '').toLowerCase();
  write(invites);

  return { ok: true, id: match.id };
}

/** Everything except the hashes — safe for the admin interface. */
function list() {
  return Object.values(read())
    .map(({ hash, ...rest }) => ({ ...rest, status: statusOf(rest) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function revoke(id) {
  const invites = read();
  if (!invites[id]) return false;
  delete invites[id];
  write(invites);
  return true;
}

/** Drops used and expired codes. Housekeeping only; nothing depends on it. */
function purgeSpent() {
  const invites = read();
  let removed = 0;
  for (const [id, record] of Object.entries(invites)) {
    if (statusOf(record) !== 'active') {
      delete invites[id];
      removed += 1;
    }
  }
  if (removed) write(invites);
  return removed;
}

module.exports = { issue, consume, list, revoke, purgeSpent, INVITES_PATH };
