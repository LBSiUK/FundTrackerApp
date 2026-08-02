'use strict';

// Synced snapshots, one per account.
//
// This used to be a single snapshot.json for the whole server, which was fine
// while there was exactly one user and silently wrong the moment there were
// two — the second phone's sync would replace the first's records. Keyed by
// account id, a full replace only ever replaces your own.

const { db } = require('./db');

const EMPTY = { syncedAt: null, devices: [], sales: [] };

function read(accountId) {
  const row = db.prepare('SELECT synced_at, payload FROM snapshots WHERE account_id = ?').get(accountId);
  if (!row) return { ...EMPTY };

  try {
    const payload = JSON.parse(row.payload);
    return { syncedAt: row.synced_at, devices: payload.devices || [], sales: payload.sales || [] };
  } catch {
    // A corrupt payload shouldn't take the dashboard down with it.
    return { ...EMPTY };
  }
}

function write(accountId, { devices, sales }) {
  const syncedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO snapshots (account_id, synced_at, payload)
    VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET synced_at = excluded.synced_at, payload = excluded.payload
  `).run(accountId, syncedAt, JSON.stringify({ devices, sales }));

  return { syncedAt, devices, sales };
}

function clear(accountId) {
  return db.prepare('DELETE FROM snapshots WHERE account_id = ?').run(accountId).changes > 0;
}

module.exports = { read, write, clear };
