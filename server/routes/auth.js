'use strict';

const express = require('express');
const users = require('../services/users');
const devices = require('../services/devices');
const invites = require('../services/invites');
const session = require('../middleware/session');

const router = express.Router();

// Simple in-memory throttle. Enough to make online guessing useless; the real
// defence against an offline attack is the scrypt cost in services/users.js.
// Shared by both password endpoints, so an attacker can't get a fresh budget
// by switching from /login to /device.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// Matches the floor scripts/set-password.js enforces, so an account made in the
// app can't be weaker than one made on the server.
const MIN_PASSWORD = 12;
const attempts = new Map();

function tooManyAttempts(key) {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now > record.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  record.count += 1;
  return record.count > MAX_ATTEMPTS;
}

function clearAttempts(key) {
  attempts.delete(key);
}

// Drop expired entries occasionally so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts) {
    if (now > record.resetAt) attempts.delete(key);
  }
}, WINDOW_MS).unref();

/**
 * Shared front half of both password endpoints: throttle, then check the
 * credentials. Returns the normalised username, or null once it has already
 * sent the error response.
 */
function checkCredentials(req, res) {
  const key = req.ip || 'unknown';
  if (tooManyAttempts(key)) {
    res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many attempts. Try again in 15 minutes.',
    });
    return null;
  }

  const { username, email, password } = req.body || {};
  // The app calls the field "email" and the dashboard calls it "username".
  // They're the same string: what matters is that it matches a key in users.json.
  const supplied = username ?? email;

  const account = users.authenticate(supplied, password);
  if (!account) {
    // Deliberately vague: don't reveal whether the account exists, or whether
    // it exists but has been disabled.
    res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    return null;
  }

  clearAttempts(key);
  return account;
}

router.post('/login', (req, res) => {
  if (!session.hasSecret()) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'SESSION_SECRET is not set on the server.',
    });
  }

  const account = checkCredentials(req, res);
  if (!account) return;

  session.setCookie(req, res, account.username);
  res.json({ ok: true, username: account.username, role: account.role });
});

// POST /api/auth/device — the iOS app exchanges a password for a sync token.
//
// This is the only place the app sends your password, and it doesn't keep it:
// what goes into the Keychain is the token this returns. The token can write
// (POST /api/sync) and nothing else, so the phone never holds a credential that
// could read your records back.
router.post('/device', (req, res) => {
  const account = checkCredentials(req, res);
  if (!account) return;

  const { deviceName } = req.body || {};
  const issued = devices.issue(account.username, deviceName);

  res.json({
    ok: true,
    token: issued.token, // returned once, never recoverable
    deviceId: issued.id,
    deviceName: issued.name,
    username: account.username,
  });
});

// POST /api/auth/register — create an account, which requires a code.
//
// Registration is closed: without a one-time code from an admin this endpoint
// creates nothing. That's what stops a publicly reachable server from being an
// open sign-up. The code is consumed and marked used in the same operation.
router.post('/register', (req, res) => {
  const key = req.ip || 'unknown';
  if (tooManyAttempts(key)) {
    return res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many attempts. Try again in 15 minutes.',
    });
  }

  const { email, username, password, code, deviceName } = req.body || {};
  const supplied = String(username ?? email ?? '').trim().toLowerCase();

  if (!supplied) {
    return res.status(400).json({ error: 'bad_request', message: 'An email is required.' });
  }

  if (String(password || '').length < MIN_PASSWORD) {
    return res.status(400).json({
      error: 'weak_password',
      message: `Use at least ${MIN_PASSWORD} characters — this login is reachable from the internet.`,
    });
  }

  if (users.getUser(supplied)) {
    // The code hasn't been consumed at this point, so it stays usable.
    return res.status(409).json({ error: 'exists', message: 'That account already exists.' });
  }

  const redeemed = invites.consume(code, supplied);
  if (!redeemed.ok) {
    const message = {
      used: 'That activation code has already been used.',
      expired: 'That activation code has expired.',
      invalid: 'That activation code is not valid.',
    }[redeemed.reason];
    return res.status(403).json({ error: `code_${redeemed.reason}`, message });
  }

  users.setUser(supplied, password, { role: 'user', active: true });
  clearAttempts(key);

  // Hand back a device token too, so the app goes straight from "create
  // account" to synced without a second round of typing the password.
  const issued = devices.issue(supplied, deviceName);

  res.status(201).json({
    ok: true,
    token: issued.token,
    deviceId: issued.id,
    deviceName: issued.name,
    username: supplied,
  });
});

// POST /api/auth/delete-account — remove your own account from the app.
//
// Password-gated rather than token-gated on purpose: a sync token is a
// write-scoped credential that lives on a phone, and "can upload records"
// should not imply "can delete the account".
router.post('/delete-account', (req, res) => {
  const account = checkCredentials(req, res);
  if (!account) return;

  if (account.role === 'admin' && users.countAdmins() <= 1) {
    return res.status(409).json({
      error: 'last_admin',
      message: 'This is the only admin account. Promote another before deleting it.',
    });
  }

  devices.revokeAllForUser(account.username);
  users.deleteUser(account.username);

  res.json({ ok: true, deleted: account.username });
});

router.post('/logout', (req, res) => {
  session.clearCookie(res);
  res.json({ ok: true });
});

// Lets the page decide between showing the dashboard and the login form,
// without having to fire a failing data request first.
router.get('/me', (req, res) => {
  const user = session.currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Not signed in.' });

  // Role comes from users.json rather than the cookie, so the dashboard stops
  // offering the admin link the moment the account is demoted.
  const account = users.getUser(user);
  if (!account || !account.active) {
    return res.status(401).json({ error: 'unauthorized', message: 'Not signed in.' });
  }

  res.json({ username: account.username, role: account.role });
});

module.exports = router;
