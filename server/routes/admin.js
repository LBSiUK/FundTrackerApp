'use strict';

// Admin API.
//
// Everything addresses accounts by **id**, not by name — that's what makes
// renaming safe, and it's why devices, invites, snapshots and photos all follow
// an account through a rename without any rewriting.
//
// Three invariants are enforced here rather than in the page, because the page
// is not the only possible caller:
//
//   1. The last active admin can't be deleted, demoted or deactivated. Losing
//      every admin means nobody can create one again without shell access.
//   2. You can't demote or deactivate yourself.
//   3. Disabling an account or changing its password revokes its device tokens,
//      so a phone already holding one stops syncing.

const express = require('express');
const accounts = require('../services/accounts');
const devices = require('../services/devices');
const invites = require('../services/invites');
const photos = require('../services/photos');
const store = require('../services/store');
const { requireAdmin } = require('../middleware/session');

const router = express.Router();

router.use(requireAdmin);

const conflict = (res, message) => res.status(409).json({ error: 'conflict', message });
const notFound = (res, message) => res.status(404).json({ error: 'not_found', message });

function weakPassword(res, password, confirm) {
  if (String(password || '').length < accounts.MIN_PASSWORD) {
    res.status(400).json({ error: 'weak_password', message: `Use at least ${accounts.MIN_PASSWORD} characters.` });
    return true;
  }
  if (confirm !== undefined && String(password) !== String(confirm)) {
    res.status(400).json({ error: 'password_mismatch', message: "The passwords don't match." });
    return true;
  }
  return false;
}

/** True when acting on this account would leave the server with no admin. */
function wouldStrandServer(account, removingAdmin) {
  if (!removingAdmin) return false;
  if (account.role !== 'admin' || !account.active) return false;
  return accounts.countAdmins() <= 1;
}

function loadAccount(req, res) {
  const account = accounts.byId(Number(req.params.id));
  if (!account) {
    notFound(res, 'No such account.');
    return null;
  }
  return account;
}

// MARK: accounts

router.get('/accounts', (req, res, next) => {
  try {
    // Paged and searchable: an admin page that loaded every row would stop
    // working long before the database did.
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = accounts.list({ search: req.query.search || '', limit, offset });

    res.json({ ...result, you: { id: req.account.id, username: req.account.username } });
  } catch (err) {
    next(err);
  }
});

router.post('/accounts', (req, res, next) => {
  try {
    const { username, email, password, confirmPassword, role } = req.body || {};
    const name = accounts.normaliseName(username ?? email);

    if (!name) return res.status(400).json({ error: 'bad_request', message: 'An email is required.' });
    if (weakPassword(res, password, confirmPassword)) return;
    if (accounts.byUsername(name)) return conflict(res, 'That account already exists.');

    const account = accounts.create({
      username: name,
      password,
      role: role === 'admin' ? 'admin' : 'user',
      active: true,
    });

    res.status(201).json({ ok: true, account });
  } catch (err) {
    next(err);
  }
});

router.get('/accounts/:id', (req, res, next) => {
  try {
    const account = loadAccount(req, res);
    if (!account) return;

    const snapshot = store.read(account.id);
    res.json({
      account,
      devices: devices.listForAccount(account.id),
      photos: photos.statsForAccount(account.id),
      fund: {
        syncedAt: snapshot.syncedAt,
        deviceCount: snapshot.devices.length,
        saleCount: snapshot.sales.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/accounts/:id', (req, res, next) => {
  try {
    const account = loadAccount(req, res);
    if (!account) return;

    const { username, role, active, password, confirmPassword } = req.body || {};
    const isSelf = account.id === req.account.id;

    if (username !== undefined && accounts.normaliseName(username) !== account.username) {
      const renamed = accounts.rename(account.id, username);
      if (!renamed.ok) {
        return renamed.reason === 'taken'
          ? conflict(res, 'Another account already uses that name.')
          : res.status(400).json({ error: 'bad_request', message: 'A username is required.' });
      }
    }

    if (role !== undefined && role !== account.role) {
      if (isSelf && role !== 'admin') return conflict(res, "You can't remove your own admin access.");
      if (wouldStrandServer(account, role !== 'admin')) {
        return conflict(res, 'That would leave the server with no admin.');
      }
      accounts.setRole(account.id, role);
    }

    if (active !== undefined && Boolean(active) !== account.active) {
      if (isSelf && !active) return conflict(res, "You can't deactivate your own account.");
      if (wouldStrandServer(account, !active)) {
        return conflict(res, 'That would leave the server with no admin.');
      }
      accounts.setActive(account.id, Boolean(active));
      if (!active) devices.revokeAllForAccount(account.id);
    }

    if (password !== undefined) {
      if (weakPassword(res, password, confirmPassword)) return;
      // Set by an admin, so the holder is made to choose their own on next login.
      accounts.setPassword(account.id, password, { mustChange: !isSelf });
      devices.revokeAllForAccount(account.id);
    }

    res.json({ ok: true, account: accounts.byId(account.id) });
  } catch (err) {
    next(err);
  }
});

router.delete('/accounts/:id', (req, res, next) => {
  try {
    const account = loadAccount(req, res);
    if (!account) return;

    if (account.id === req.account.id) return conflict(res, "You can't delete the account you're signed in as.");
    if (wouldStrandServer(account, true)) return conflict(res, 'That would leave the server with no admin.');

    const deviceCount = devices.countForAccount(account.id);
    // Devices, snapshot and photo ownership cascade from the account row.
    photos.prune(account.id, []);
    accounts.remove(account.id);

    res.json({ ok: true, deleted: account.username, devicesRevoked: deviceCount });
  } catch (err) {
    next(err);
  }
});

// MARK: devices — always in the context of one account

router.get('/accounts/:id/devices', (req, res, next) => {
  try {
    const account = loadAccount(req, res);
    if (!account) return;
    res.json({ devices: devices.listForAccount(account.id) });
  } catch (err) {
    next(err);
  }
});

router.delete('/devices/:deviceId', (req, res, next) => {
  try {
    if (!devices.byId(req.params.deviceId)) return notFound(res, 'No such device.');
    devices.revoke(req.params.deviceId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// MARK: activation codes

router.get('/invites', (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json(invites.list({ limit, offset }));
  } catch (err) {
    next(err);
  }
});

router.post('/invites', (req, res, next) => {
  try {
    const { expiresInDays, note } = req.body || {};
    const days = Number(expiresInDays);

    const issued = invites.issue({
      createdBy: req.account.id,
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
    if (!invites.revoke(req.params.id)) return notFound(res, 'No such code.');
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
