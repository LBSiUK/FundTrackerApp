'use strict';

const express = require('express');
const accounts = require('../services/accounts');
const devices = require('../services/devices');
const invites = require('../services/invites');
const session = require('../middleware/session');

const router = express.Router();

// Simple in-memory throttle. Enough to make online guessing useless; the real
// defence against an offline attack is the scrypt cost in services/accounts.js.
// Shared by every password endpoint, so an attacker can't get a fresh budget by
// switching from /login to /device.
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

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts) {
    if (now > record.resetAt) attempts.delete(key);
  }
}, WINDOW_MS).unref();

function weakPassword(res, password, confirm) {
  if (String(password || '').length < accounts.MIN_PASSWORD) {
    res.status(400).json({
      error: 'weak_password',
      message: `Use at least ${accounts.MIN_PASSWORD} characters — this login is reachable from the internet.`,
    });
    return true;
  }

  // Confirmation is checked server-side as well as in the UI: a typo'd password
  // you can't reproduce is indistinguishable from a lost account.
  if (confirm !== undefined && String(password) !== String(confirm)) {
    res.status(400).json({ error: 'password_mismatch', message: "The passwords don't match." });
    return true;
  }

  return false;
}

/** Throttle, then check credentials. Returns the account, or null once handled. */
function checkCredentials(req, res) {
  const key = req.ip || 'unknown';
  if (tooManyAttempts(key)) {
    res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Try again in 15 minutes.' });
    return null;
  }

  const { username, email, password } = req.body || {};
  const account = accounts.authenticate(username ?? email, password);

  if (!account) {
    // Deliberately vague: don't reveal whether the account exists, or exists
    // but is disabled.
    res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    return null;
  }

  clearAttempts(key);
  return account;
}

router.post('/login', (req, res) => {
  if (!session.hasSecret()) {
    return res.status(503).json({ error: 'not_configured', message: 'SESSION_SECRET is not set on the server.' });
  }

  const account = checkCredentials(req, res);
  if (!account) return;

  session.setCookie(req, res, account.id);
  res.json({
    ok: true,
    username: account.username,
    role: account.role,
    mustChangePassword: account.mustChangePassword,
  });
});

// POST /api/auth/change-password — the only thing an account with a default or
// reset password may do. requireSession lets this through and blocks the rest.
router.post('/change-password', session.requireSession, (req, res) => {
  const { currentPassword, password, confirmPassword } = req.body || {};

  if (!accounts.authenticate(req.account.username, currentPassword)) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Current password is incorrect.' });
  }

  if (weakPassword(res, password, confirmPassword)) return;

  if (String(password) === String(currentPassword)) {
    return res.status(400).json({ error: 'password_unchanged', message: 'Choose a different password.' });
  }

  accounts.setPassword(req.account.id, password, { mustChange: false });
  // Anything holding a token issued under the old password goes with it.
  devices.revokeAllForAccount(req.account.id);

  res.json({ ok: true });
});

// POST /api/auth/device — the iOS app exchanges a password for a sync token.
//
// This is the only place the app sends a password, and it doesn't keep it: what
// goes into the Keychain is the token returned here. That token can write and
// nothing else.
router.post('/device', (req, res) => {
  const account = checkCredentials(req, res);
  if (!account) return;

  if (account.role === 'admin') {
    return res.status(403).json({
      error: 'admin_has_no_fund',
      message: 'The admin account manages the server and has no fund to sync.',
    });
  }

  if (account.mustChangePassword) {
    return res.status(428).json({
      error: 'password_change_required',
      message: 'Set a new password on the website before connecting the app.',
    });
  }

  const issued = devices.issue(account.id, (req.body || {}).deviceName);

  res.json({
    ok: true,
    token: issued.token, // returned once, never recoverable
    deviceId: issued.id,
    deviceName: issued.name,
    username: account.username,
  });
});

// POST /api/auth/register — create an account, which requires a code.
router.post('/register', (req, res) => {
  const key = req.ip || 'unknown';
  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { email, username, password, confirmPassword, code, deviceName } = req.body || {};
  const name = accounts.normaliseName(username ?? email);

  if (!name) {
    return res.status(400).json({ error: 'bad_request', message: 'An email is required.' });
  }
  if (weakPassword(res, password, confirmPassword)) return;

  if (accounts.byUsername(name)) {
    // The code is untouched at this point, so it stays usable.
    return res.status(409).json({ error: 'exists', message: 'That account already exists.' });
  }

  // Create first, then consume — so the code records which account used it, and
  // a failure creating the account can't burn a code.
  const account = accounts.create({ username: name, password, role: 'user', active: true });

  const redeemed = invites.consume(code, account.id);
  if (!redeemed.ok) {
    accounts.remove(account.id);
    const message = {
      used: 'That activation code has already been used.',
      expired: 'That activation code has expired.',
      invalid: 'That activation code is not valid.',
    }[redeemed.reason];
    return res.status(403).json({ error: `code_${redeemed.reason}`, message });
  }

  clearAttempts(key);

  // Hand back a device token too, so the app goes straight from "create
  // account" to synced without a second round of typing the password.
  const issued = devices.issue(account.id, deviceName);

  res.status(201).json({
    ok: true,
    token: issued.token,
    deviceId: issued.id,
    deviceName: issued.name,
    username: account.username,
  });
});

// POST /api/auth/delete-account — remove your own account from the app.
//
// Password-gated rather than token-gated on purpose: a sync token is a
// write-scoped credential living on a phone, and "can upload records" should
// not imply "can destroy the account".
router.post('/delete-account', (req, res) => {
  const account = checkCredentials(req, res);
  if (!account) return;

  if (account.role === 'admin' && accounts.countAdmins() <= 1) {
    return res.status(409).json({
      error: 'last_admin',
      message: 'This is the only admin account. Promote another before deleting it.',
    });
  }

  // Devices, snapshot and photo ownership all cascade from the account row.
  accounts.remove(account.id);
  res.json({ ok: true, deleted: account.username });
});

router.post('/logout', (req, res) => {
  session.clearCookie(res);
  res.json({ ok: true });
});

// Lets a page decide between showing content and the login form without firing
// a failing data request first.
router.get('/me', (req, res) => {
  const account = session.currentAccount(req);
  if (!account) return res.status(401).json({ error: 'unauthorized', message: 'Not signed in.' });

  res.json({
    username: account.username,
    role: account.role,
    mustChangePassword: account.mustChangePassword,
  });
});

module.exports = router;
