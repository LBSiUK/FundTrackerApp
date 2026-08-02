'use strict';

// Device photos: content-addressed bytes on disk, ownership in the database.
//
// The file for a given SHA-256 is stored once at `photos/<hash>.jpg` no matter
// how many accounts reference it, and the `photos` table records who may see
// it. That split matters with many users: dedupe is global, access is not.
// Reading a photo you don't own is a 404 even if the bytes are sitting there.
//
// Pruning therefore has two levels — drop this account's row, then delete the
// file only once no account references it at all.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

// The app downscales to 1280px at quality 0.8 before sending, which lands well
// under this. The limit is here to stop anything else.
const MAX_BYTES = 3 * 1024 * 1024;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function isValidHash(hash) {
  return typeof hash === 'string' && HASH_PATTERN.test(hash);
}

/** JPEG start-of-image marker. Keeps the store to what it claims to hold. */
function looksLikeJpeg(buffer) {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function pathFor(hash) {
  if (!isValidHash(hash)) throw new Error('invalid hash');
  return path.join(PHOTOS_DIR, `${hash}.jpg`);
}

/** Does this account have a row for this photo? Ownership, not existence. */
function has(accountId, hash) {
  if (!isValidHash(hash)) return false;
  const row = db.prepare('SELECT 1 AS ok FROM photos WHERE account_id = ? AND hash = ?').get(accountId, hash);
  return Boolean(row) && fs.existsSync(pathFor(hash));
}

function save(accountId, hash, buffer) {
  const fail = (code, message) => {
    const err = new Error(message);
    err.code = code;
    throw err;
  };

  if (!isValidHash(hash)) fail('invalid_hash', 'Photo id must be a SHA-256 hex digest.');
  if (!buffer || buffer.length === 0) fail('empty', 'Empty body.');
  if (buffer.length > MAX_BYTES) fail('too_large', `Photo is larger than ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`);
  if (!looksLikeJpeg(buffer)) fail('not_jpeg', 'Body is not a JPEG.');

  // The whole scheme rests on the name matching the content; verify rather
  // than trust the uploader.
  const actual = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actual !== hash) fail('hash_mismatch', 'Body does not match the given hash.');

  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  const target = pathFor(hash);

  // Another account may already have uploaded these exact bytes.
  if (!fs.existsSync(target)) {
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buffer, { mode: 0o600 });
    fs.renameSync(tmp, target);
  }

  db.prepare(`
    INSERT INTO photos (account_id, hash, bytes, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, hash) DO NOTHING
  `).run(accountId, hash, buffer.length, new Date().toISOString());

  return { hash, bytes: buffer.length };
}

/** Of the hashes given, the ones this account doesn't already own. */
function missing(accountId, hashes) {
  const wanted = [...new Set((Array.isArray(hashes) ? hashes : []).filter(isValidHash))];
  return wanted.filter((hash) => !has(accountId, hash));
}

/**
 * Drops this account's claim on anything the snapshot no longer references,
 * then deletes files nobody references any more.
 */
function prune(accountId, keepHashes) {
  const keep = new Set((keepHashes || []).filter(isValidHash));

  const owned = db.prepare('SELECT hash FROM photos WHERE account_id = ?').all(accountId);
  const orphaned = owned.map((row) => row.hash).filter((hash) => !keep.has(hash));
  if (orphaned.length === 0) return 0;

  const dropRow = db.prepare('DELETE FROM photos WHERE account_id = ? AND hash = ?');
  const stillWanted = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE hash = ?');

  for (const hash of orphaned) {
    dropRow.run(accountId, hash);

    // Only now is it safe to remove the bytes — another account may share them.
    if (stillWanted.get(hash).n === 0) {
      try {
        fs.unlinkSync(pathFor(hash));
      } catch {
        // Already gone, or unreadable; not worth failing a sync over.
      }
    }
  }

  return orphaned.length;
}

function statsForAccount(accountId) {
  const row = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM photos WHERE account_id = ?')
    .get(accountId);
  return { count: row.count, bytes: row.bytes };
}

module.exports = { has, save, missing, prune, pathFor, statsForAccount, isValidHash, MAX_BYTES, PHOTOS_DIR };
