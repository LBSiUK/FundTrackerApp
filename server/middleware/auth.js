'use strict';

// Guards the write side (POST /api/sync). Two kinds of bearer token are
// accepted:
//
//   1. A per-device token, issued by POST /api/auth/device when the app signs
//      in. This is the normal path — each phone has its own, and one can be
//      revoked without touching the others.
//
//   2. FUNDTRACKER_TOKEN, the single shared token from before device tokens
//      existed. Kept so an already-configured phone keeps syncing across the
//      upgrade. Leave it out of .env once every device has signed in properly
//      and this path disappears.
//
// Neither kind can read anything: /api/summary and /api/snapshot require a
// login session instead. A token lifted off a phone still shows an attacker
// nothing.

const crypto = require('crypto');
const devices = require('../services/devices');

const LEGACY_TOKEN = process.env.FUNDTRACKER_TOKEN || '';

// Constant-time compare so a wrong token can't be guessed byte by byte from timing.
function matchesLegacy(supplied) {
  if (!LEGACY_TOKEN) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(LEGACY_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = function requireToken(req, res, next) {
  const header = req.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!supplied) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid token.',
    });
  }

  const device = devices.verify(supplied);
  if (device) {
    req.device = device;
    devices.touch(device.id);
    return next();
  }

  if (matchesLegacy(supplied)) {
    req.device = null;
    return next();
  }

  return res.status(401).json({
    error: 'unauthorized',
    message: 'Missing or invalid token.',
  });
};
