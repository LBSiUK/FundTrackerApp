'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FUNDTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'snapshot.json');

const EMPTY = { syncedAt: null, devices: [], sales: [] };

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { ...EMPTY };
    throw err;
  }
}

// Write to a temp file then rename, so a crash mid-write can't leave a
// half-written snapshot behind — rename is atomic on the same filesystem.
function write(snapshot) {
  ensureDir();
  const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmp, SNAPSHOT_PATH);
  return snapshot;
}

module.exports = { read, write, DATA_DIR, SNAPSHOT_PATH };
