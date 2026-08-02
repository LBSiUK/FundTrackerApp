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

/**
 * Records gained `role`, `active` and `createdAt` when the admin interface
 * arrived. Accounts written before that are plain `{ password }`, so every read
 * goes through here rather than assuming the newer shape.
 */
function normalise(username, record) {
  if (!record) return null;
  return {
    username,
    password: record.password,
    role: record.role === 'admin' ? 'admin' : 'user',
    // Absent means an account from before the flag existed, which was usable.
    active: record.active !== false,
    createdAt: record.createdAt || null,
  };
}

function getUser(username) {
  const key = String(username || '').toLowerCase();
  return normalise(key, readUsers()[key]);
}

function setUser(username, password, options = {}) {
  const users = readUsers();
  const key = username.toLowerCase();
  const existing = users[key];

  users[key] = {
    password: hashPassword(password),
    role: options.role || (existing && existing.role) || 'user',
    active: options.active !== undefined ? options.active : (existing ? existing.active !== false : true),
    createdAt: (existing && existing.createdAt) || new Date().toISOString(),
  };
  writeUsers(users);
  return normalise(key, users[key]);
}

/** Changes a password without touching role or active state. */
function setPassword(username, password) {
  const users = readUsers();
  const key = String(username || '').toLowerCase();
  if (!users[key]) return false;
  users[key].password = hashPassword(password);
  writeUsers(users);
  return true;
}

function setRole(username, role) {
  const users = readUsers();
  const key = String(username || '').toLowerCase();
  if (!users[key]) return false;
  users[key].role = role === 'admin' ? 'admin' : 'user';
  writeUsers(users);
  return true;
}

function setActive(username, active) {
  const users = readUsers();
  const key = String(username || '').toLowerCase();
  if (!users[key]) return false;
  users[key].active = Boolean(active);
  writeUsers(users);
  return true;
}

function deleteUser(username) {
  const users = readUsers();
  const key = String(username || '').toLowerCase();
  if (!users[key]) return false;
  delete users[key];
  writeUsers(users);
  return true;
}

/** Every account, without password hashes — safe for the admin interface. */
function listUsers() {
  const users = readUsers();
  return Object.keys(users)
    .sort()
    .map((key) => {
      const { password, ...rest } = normalise(key, users[key]);
      return rest;
    });
}

function countAdmins() {
  return listUsers().filter((user) => user.role === 'admin' && user.active).length;
}

/**
 * Always runs a scrypt derivation, even for an unknown username, so response
 * timing doesn't reveal which usernames exist.
 */
const DUMMY_HASH = hashPassword(crypto.randomBytes(32).toString('hex'));

/** Returns the account on success, or null. Disabled accounts never succeed. */
function authenticate(username, password) {
  const key = String(username || '').toLowerCase();
  const record = readUsers()[key];
  const stored = record ? record.password : DUMMY_HASH;
  const ok = verifyPassword(String(password || ''), stored);
  if (!ok || !record) return null;

  const user = normalise(key, record);
  return user.active ? user : null;
}

function hasAnyUser() {
  return Object.keys(readUsers()).length > 0;
}

module.exports = {
  authenticate,
  getUser,
  setUser,
  setPassword,
  setRole,
  setActive,
  deleteUser,
  listUsers,
  countAdmins,
  hasAnyUser,
  hashPassword,
  verifyPassword,
  USERS_PATH,
};
