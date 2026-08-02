'use strict';

// Guards the write side (sync and photo upload) with a per-device bearer token.
//
// The token resolves to a device *and* the account that owns it, and every
// write is then scoped to that account id. With several users on one server
// that scoping is what stops one phone's sync replacing someone else's records.
//
// A token can never read: /api/summary and /api/snapshot need a login session.
// One lifted off a phone still shows an attacker nothing.

const devices = require('../services/devices');

module.exports = function requireToken(req, res, next) {
  const header = req.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  const unauthorized = () =>
    res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid token.' });

  if (!supplied) return unauthorized();

  // Also null when the owning account is disabled, so deactivating an account
  // stops its phones syncing without needing to hunt down their tokens.
  const device = devices.verify(supplied);
  if (!device) return unauthorized();

  devices.touch(device.id);
  req.device = device;
  req.accountId = device.accountId;
  next();
};
