'use strict';

const express = require('express');
const users = require('../services/users');
const devices = require('../services/devices');
const session = require('../middleware/session');

const router = express.Router();

// Simple in-memory throttle. Enough to make online guessing useless; the real
// defence against an offline attack is the scrypt cost in services/users.js.
// Shared by both password endpoints, so an attacker can't get a fresh budget
// by switching from /login to /device.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
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

  if (!users.authenticate(supplied, password)) {
    // Deliberately vague: don't reveal whether the account exists.
    res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    return null;
  }

  clearAttempts(key);
  return String(supplied).toLowerCase();
}

router.post('/login', (req, res) => {
  if (!session.hasSecret()) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'SESSION_SECRET is not set on the server.',
    });
  }

  const username = checkCredentials(req, res);
  if (!username) return;

  session.setCookie(req, res, username);
  res.json({ ok: true, username });
});

// POST /api/auth/device — the iOS app exchanges a password for a sync token.
//
// This is the only place the app sends your password, and it doesn't keep it:
// what goes into the Keychain is the token this returns. The token can write
// (POST /api/sync) and nothing else, so the phone never holds a credential that
// could read your records back.
router.post('/device', (req, res) => {
  const username = checkCredentials(req, res);
  if (!username) return;

  const { deviceName } = req.body || {};
  const issued = devices.issue(username, deviceName);

  res.json({
    ok: true,
    token: issued.token, // returned once, never recoverable
    deviceId: issued.id,
    deviceName: issued.name,
    username,
  });
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
  res.json({ username: user });
});

module.exports = router;
