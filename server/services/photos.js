'use strict';

// Device photos, stored by content hash.
//
// A photo is written to `data/photos/<sha256>.jpg`, and the snapshot refers to
// it by that hash. Content-addressing buys three things cheaply:
//
//   - **Idempotence.** Re-uploading the same photo is a no-op, so a repeated
//     sync costs nothing and an interrupted one can simply be retried.
//   - **Dedupe.** The same photo on two devices is stored once.
//   - **Safe paths.** The filename is derived from the content, never from
//     anything a caller chose, and is checked against a strict hex pattern
//     before it ever reaches the filesystem.
//
// The phone only uploads hashes the server says it is missing, so photos cross
// the network once rather than on every sync.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FUNDTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
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

function has(hash) {
  if (!isValidHash(hash)) return false;
  return fs.existsSync(pathFor(hash));
}

/**
 * Stores a photo under its own hash.
 * Throws with a `code` when the bytes aren't what was claimed.
 */
function save(hash, buffer) {
  if (!isValidHash(hash)) {
    const err = new Error('Photo id must be a SHA-256 hex digest.');
    err.code = 'invalid_hash';
    throw err;
  }

  if (!buffer || buffer.length === 0) {
    const err = new Error('Empty body.');
    err.code = 'empty';
    throw err;
  }

  if (buffer.length > MAX_BYTES) {
    const err = new Error(`Photo is larger than ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`);
    err.code = 'too_large';
    throw err;
  }

  if (!looksLikeJpeg(buffer)) {
    const err = new Error('Body is not a JPEG.');
    err.code = 'not_jpeg';
    throw err;
  }

  // The whole scheme rests on the name matching the content; verify rather
  // than trust the uploader.
  const actual = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actual !== hash) {
    const err = new Error('Body does not match the given hash.');
    err.code = 'hash_mismatch';
    throw err;
  }

  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  const target = pathFor(hash);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  fs.renameSync(tmp, target);

  return { hash, bytes: buffer.length };
}

/** Of the hashes given, the ones not stored yet. */
function missing(hashes) {
  const wanted = Array.isArray(hashes) ? hashes : [];
  return [...new Set(wanted.filter(isValidHash))].filter((hash) => !has(hash));
}

/**
 * Deletes stored photos no longer referenced by the snapshot.
 * The phone is the source of truth: removing a photo there should not leave a
 * copy on the server forever.
 */
function prune(keepHashes) {
  const keep = new Set((keepHashes || []).filter(isValidHash));

  let entries;
  try {
    entries = fs.readdirSync(PHOTOS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }

  let removed = 0;
  for (const entry of entries) {
    const hash = entry.replace(/\.jpg$/, '');
    // Skip anything that isn't a finished photo — .tmp files from an
    // in-flight write, most obviously.
    if (!isValidHash(hash) || !entry.endsWith('.jpg')) continue;
    if (keep.has(hash)) continue;

    try {
      fs.unlinkSync(path.join(PHOTOS_DIR, entry));
      removed += 1;
    } catch {
      // A photo that can't be deleted isn't worth failing a sync over.
    }
  }

  return removed;
}

function stats() {
  let entries;
  try {
    entries = fs.readdirSync(PHOTOS_DIR);
  } catch {
    return { count: 0, bytes: 0 };
  }

  let bytes = 0;
  let count = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.jpg')) continue;
    try {
      bytes += fs.statSync(path.join(PHOTOS_DIR, entry)).size;
      count += 1;
    } catch {
      // Raced with a prune; ignore.
    }
  }
  return { count, bytes };
}

module.exports = { has, save, missing, prune, pathFor, stats, isValidHash, MAX_BYTES, PHOTOS_DIR };
