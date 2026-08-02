'use strict';

// Your own phones.
//
// Scoped to the signed-in account throughout. `requireUser` rather than
// `requireSession`, because an admin has no devices of its own — it manages
// everyone's from /admin.
//
// The ownership check on revoke is the important line here. Device ids are
// UUIDs, but "hard to guess" is not an authorisation model: without the check,
// any signed-in user could revoke any other account's phone.

const express = require('express');
const devices = require('../services/devices');
const { requireUser } = require('../middleware/session');

const router = express.Router();

router.get('/', requireUser, (req, res, next) => {
  try {
    res.json({ devices: devices.listForAccount(req.account.id) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireUser, (req, res, next) => {
  try {
    const device = devices.byId(req.params.id);

    // Same 404 whether it doesn't exist or isn't yours, so this can't be used
    // to probe which device ids are real.
    if (!device || device.accountId !== req.account.id) {
      return res.status(404).json({ error: 'not_found', message: 'No such device.' });
    }

    devices.revoke(device.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
