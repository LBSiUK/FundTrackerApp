'use strict';

// Managing the phones that are allowed to sync. Read side only — these sit
// behind the login session, not behind a device token, so a compromised phone
// can't list or revoke its siblings.

const express = require('express');
const devices = require('../services/devices');
const { requireSession } = require('../middleware/session');

const router = express.Router();

router.get('/', requireSession, (req, res, next) => {
  try {
    res.json({ devices: devices.list() });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireSession, (req, res, next) => {
  try {
    const removed = devices.revoke(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'not_found', message: 'No such device.' });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
