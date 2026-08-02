'use strict';

const express = require('express');
const store = require('../services/store');
const summary = require('../services/summary');
const photos = require('../services/photos');
const requireToken = require('../middleware/auth');
const { requireUser } = require('../middleware/session');

const router = express.Router();

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'bad_request';
  return err;
}

// POST /api/sync — the iOS app pushes its whole dataset.
//
// A full replace rather than a merge: the phone is the source of truth and the
// dashboard is read-only, so there is nothing on this side to lose. Scoped to
// the account the device token belongs to, so one user's sync never touches
// another's records.
router.post('/sync', requireToken, (req, res, next) => {
  try {
    const { devices, sales } = req.body || {};

    if (!Array.isArray(devices) || !Array.isArray(sales)) {
      throw badRequest('Body must include "devices" and "sales" arrays.');
    }

    const snapshot = store.write(req.accountId, { devices, sales });

    // Photos are referenced by content hash and uploaded separately, so the
    // sync payload stays small and a photo crosses the network once.
    const referenced = devices.map((device) => device.photoHash).filter(Boolean);
    photos.prune(req.accountId, referenced);

    res.json({
      ok: true,
      syncedAt: snapshot.syncedAt,
      deviceCount: devices.length,
      saleCount: sales.length,
      missingPhotos: photos.missing(req.accountId, referenced),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/summary — everything the dashboard renders, computed server-side.
router.get('/summary', requireUser, (req, res, next) => {
  try {
    res.json(summary.build(store.read(req.account.id)));
  } catch (err) {
    next(err);
  }
});

// GET /api/snapshot — the raw stored payload, handy for backups.
router.get('/snapshot', requireUser, (req, res, next) => {
  try {
    res.json(store.read(req.account.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
