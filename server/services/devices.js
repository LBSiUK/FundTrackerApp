'use strict';

// Per-device sync tokens.
//
// A device token is what the iOS app actually stores after you sign in. The
// password is exchanged for one of these once, during onboarding, and is never
// kept on the phone. Each device gets its own, so losing a phone means revoking
// one token rather than rotating a shared secret for everything you own.
//
// These are hashed with plain SHA-256 rather than scrypt. That's deliberate and
// not an oversight: a token is 32 bytes of CSPRNG output, so there is no
// dictionary to attack and no work factor worth paying. Passwords need scrypt
// because humans choose them; tokens don't.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FUNDTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
const DEVICES_PATH = path.join(DATA_DIR, 'devices.json');

const TOKEN_BYTES = 32;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest();
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function write(devices) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DEVICES_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(devices, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DEVICES_PATH);
}

/**
 * Mints a token for a device and stores only its hash.
 * The raw token is returned once and cannot be recovered afterwards.
 */
function issue(username, deviceName) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const id = crypto.randomUUID();

  const devices = read();
  devices[id] = {
    id,
    name: String(deviceName || 'iPhone').slice(0, 60),
    user: String(username).toLowerCase(),
    tokenHash: hashToken(token).toString('base64'),
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  };
  write(devices);

  return { token, id, name: devices[id].name };
}

/**
 * Returns the device record for a raw token, or null.
 * Compares in constant time so a near-miss token can't be refined by timing.
 */
function verify(token) {
  if (!token) return null;

  const supplied = hashToken(token);
  const devices = read();

  for (const record of Object.values(devices)) {
    const stored = Buffer.from(record.tokenHash, 'base64');
    if (stored.length === supplied.length && crypto.timingSafeEqual(stored, supplied)) {
      return record;
    }
  }

  return null;
}

/** Records that a device just synced. Best-effort: never fails the request. */
function touch(id) {
  try {
    const devices = read();
    if (!devices[id]) return;
    devices[id].lastSeenAt = new Date().toISOString();
    write(devices);
  } catch {
    // A failed timestamp update isn't worth rejecting a sync over.
  }
}

/** Everything except the hashes — safe to hand to the dashboard. */
function list() {
  return Object.values(read())
    .map(({ tokenHash, ...rest }) => rest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function revoke(id) {
  const devices = read();
  if (!devices[id]) return false;
  delete devices[id];
  write(devices);
  return true;
}

function revokeAllForUser(username) {
  const devices = read();
  const target = String(username).toLowerCase();
  let removed = 0;

  for (const [id, record] of Object.entries(devices)) {
    if (record.user === target) {
      delete devices[id];
      removed += 1;
    }
  }

  if (removed) write(devices);
  return removed;
}

module.exports = { issue, verify, touch, list, revoke, revokeAllForUser, DEVICES_PATH };
