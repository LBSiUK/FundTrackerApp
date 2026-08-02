'use strict';

// Admin API. Every route is behind requireAdmin, which re-reads the role from
// users.json per request rather than trusting the cookie — demoting an admin
// takes effect immediately.
//
// Two invariants are enforced here rather than left to the interface, because
// the interface is not the only possible caller:
//
//   1. You cannot remove the last active admin, by deletion, demotion or
//      deactivation. Losing every admin means nobody can create one again
//      without shell access to the box.
//   2. You cannot deactivate or demote yourself. It's almost always a misclick,
//      and the recovery is tedious.

const express = require('express');
const users = require('../services/users');
const devices = require('../services/devices');
const invites = require('../services/invites');
const { requireAdmin } = require('../middleware/session');

const router = express.Router();

const MIN_PASSWORD = 12;

router.use(requireAdmin);

function conflict(res, message) {
  return res.status(409).json({ error: 'conflict', message });
}

/** True when acting on this account would leave no active admin behind. */
function wouldStrandServer(username, { removingAdmin }) {
  if (!removingAdmin) return false;
  const account = users.getUser(username);
  if (!account || account.role !== 'admin' || !account.active) return false;
  return users.countAdmins() <= 1;
}

// MARK: accounts

router.get('/accounts', (req, res, next) => {
  try {
    const all = devices.list();
    res.json({
      accounts: users.listUsers().map((account) => ({
        ...account,
        deviceCount: all.filter((device) => device.user === account.username).length,
      })),
      you: req.account.username,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/accounts', (req, res, next) => {
  try {
    const { username, email, password, role } = req.body || {};
    const name = String(username ?? email ?? '').trim().toLowerCase();

    if (!name) {
      return res.status(400).json({ error: 'bad_request', message: 'An email is required.' });
    }
    if (String(password || '').length < MIN_PASSWORD) {
      return res.status(400).json({
        error: 'weak_password',
        message: `Use at least ${MIN_PASSWORD} characters.`,
      });
    }
    if (users.getUser(name)) {
      return conflict(res, 'That account already exists.');
    }

    const account = users.setUser(name, password, {
      role: role === 'admin' ? 'admin' : 'user',
      active: true,
    });

    res.status(201).json({ ok: true, account: { ...account, password: undefined } });
  } catch (err) {
    next(err);
  }
});

router.patch('/accounts/:username', (req, res, next) => {
  try {
    const name = String(req.params.username || '').toLowerCase();
    const account = users.getUser(name);
    if (!account) {
      return res.status(404).json({ error: 'not_found', message: 'No such account.' });
    }

    const { role, active, password } = req.body || {};
    const isSelf = name === req.account.username;

    if (role !== undefined && role !== account.role) {
      if (isSelf && role !== 'admin') {
        return conflict(res, "You can't remove your own admin access.");
      }
      if (wouldStrandServer(name, { removingAdmin: role !== 'admin' })) {
        return conflict(res, 'That would leave the server with no admin.');
      }
      users.setRole(name, role);
    }

    if (active !== undefined && Boolean(active) !== account.active) {
      if (isSelf && !active) {
        return conflict(res, "You can't deactivate your own account.");
      }
      if (wouldStrandServer(name, { removingAdmin: !active })) {
        return conflict(res, 'That would leave the server with no admin.');
      }
      users.setActive(name, Boolean(active));

      // A disabled account shouldn't keep syncing from a phone that already
      // holds a token — authenticate() blocks new sign-ins, not existing ones.
      if (!active) devices.revokeAllForUser(name);
    }

    if (password !== undefined) {
      if (String(password).length < MIN_PASSWORD) {
        return res.status(400).json({
          error: 'weak_password',
          message: `Use at least ${MIN_PASSWORD} characters.`,
        });
      }
      users.setPassword(name, password);
      // The old password is gone; anything holding a token from it should go too.
      devices.revokeAllForUser(name);
    }

    res.json({ ok: true, account: users.getUser(name) });
  } catch (err) {
    next(err);
  }
});

router.delete('/accounts/:username', (req, res, next) => {
  try {
    const name = String(req.params.username || '').toLowerCase();
    if (!users.getUser(name)) {
      return res.status(404).json({ error: 'not_found', message: 'No such account.' });
    }
    if (name === req.account.username) {
      return conflict(res, "You can't delete the account you're signed in as.");
    }
    if (wouldStrandServer(name, { removingAdmin: true })) {
      return conflict(res, 'That would leave the server with no admin.');
    }

    const revoked = devices.revokeAllForUser(name);
    users.deleteUser(name);

    res.json({ ok: true, deleted: name, devicesRevoked: revoked });
  } catch (err) {
    next(err);
  }
});

// MARK: devices

router.get('/devices', (req, res, next) => {
  try {
    res.json({ devices: devices.list() });
  } catch (err) {
    next(err);
  }
});

router.delete('/devices/:id', (req, res, next) => {
  try {
    if (!devices.revoke(req.params.id)) {
      return res.status(404).json({ error: 'not_found', message: 'No such device.' });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// MARK: activation codes

router.get('/invites', (req, res, next) => {
  try {
    res.json({ invites: invites.list() });
  } catch (err) {
    next(err);
  }
});

router.post('/invites', (req, res, next) => {
  try {
    const { expiresInDays, note } = req.body || {};
    const days = Number(expiresInDays);

    const issued = invites.issue({
      createdBy: req.account.username,
      expiresInDays: Number.isFinite(days) && days > 0 && days <= 365 ? days : undefined,
      note,
    });

    // The plaintext appears here and nowhere else, ever.
    res.status(201).json({ ok: true, ...issued });
  } catch (err) {
    next(err);
  }
});

router.delete('/invites/:id', (req, res, next) => {
  try {
    if (!invites.revoke(req.params.id)) {
      return res.status(404).json({ error: 'not_found', message: 'No such code.' });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/invites/purge', (req, res, next) => {
  try {
    res.json({ ok: true, removed: invites.purgeSpent() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
