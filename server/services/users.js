'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FUNDTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

// scrypt parameters. N is the work factor — the dominant cost. These are the
// Node defaults raised to a level that's still comfortably fast for a login
// but expensive to brute force offline.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    // scrypt needs memory proportional to N*r*128; raise the cap to match.
    maxmem: 256 * SCRYPT.N * SCRYPT.r,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
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

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${USERS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_PATH);
}

function setUser(username, password) {
  const users = readUsers();
  users[username.toLowerCase()] = { password: hashPassword(password) };
  writeUsers(users);
}

/**
 * Always runs a scrypt derivation, even for an unknown username, so response
 * timing doesn't reveal which usernames exist.
 */
const DUMMY_HASH = hashPassword(crypto.randomBytes(32).toString('hex'));

function authenticate(username, password) {
  const users = readUsers();
  const record = users[String(username || '').toLowerCase()];
  const stored = record ? record.password : DUMMY_HASH;
  const ok = verifyPassword(String(password || ''), stored);
  return ok && Boolean(record);
}

function hasAnyUser() {
  return Object.keys(readUsers()).length > 0;
}

module.exports = { authenticate, setUser, hasAnyUser, hashPassword, verifyPassword, USERS_PATH };
