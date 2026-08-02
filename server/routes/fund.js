'use strict';

const express = require('express');
const store = require('../services/store');
const summary = require('../services/summary');
const requireToken = require('../middleware/auth');
const { requireSession } = require('../middleware/session');

const router = express.Router();

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'bad_request';
  return err;
}

// POST /api/sync — the iOS app pushes its whole dataset.
// A full replace rather than a merge: the phone is the source of truth and
// the dashboard is read-only, so there is nothing on this side to lose.
//
// Machine-to-machine, so it uses the bearer token rather than a login session.
router.post('/sync', requireToken, (req, res, next) => {
  try {
    const { devices, sales } = req.body || {};

    if (!Array.isArray(devices) || !Array.isArray(sales)) {
      throw badRequest('Body must include "devices" and "sales" arrays.');
    }

    const snapshot = store.write({
      syncedAt: new Date().toISOString(),
      devices,
      sales,
    });

    res.json({
      ok: true,
      syncedAt: snapshot.syncedAt,
      deviceCount: devices.length,
      saleCount: sales.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/summary — everything the dashboard renders, computed server-side.
router.get('/summary', requireSession, (req, res, next) => {
  try {
    res.json(summary.build(store.read()));
  } catch (err) {
    next(err);
  }
});

// GET /api/snapshot — the raw stored payload, handy for backups.
router.get('/snapshot', requireSession, (req, res, next) => {
  try {
    res.json(store.read());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
