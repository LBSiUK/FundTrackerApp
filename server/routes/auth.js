'use strict';

const express = require('express');
const users = require('../services/users');
const session = require('../middleware/session');

const router = express.Router();

// Simple in-memory throttle. Enough to make online guessing useless; the real
// defence against an offline attack is the scrypt cost in services/users.js.
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

router.post('/login', (req, res) => {
  if (!session.hasSecret()) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'SESSION_SECRET is not set on the server.',
    });
  }

  const key = req.ip || 'unknown';
  if (tooManyAttempts(key)) {
    return res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many attempts. Try again in 15 minutes.',
    });
  }

  const { username, password } = req.body || {};

  if (!users.authenticate(username, password)) {
    // Deliberately vague: don't reveal whether the username exists.
    return res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect username or password.' });
  }

  clearAttempts(key);
  session.setCookie(req, res, String(username).toLowerCase());
  res.json({ ok: true, username: String(username).toLowerCase() });
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
