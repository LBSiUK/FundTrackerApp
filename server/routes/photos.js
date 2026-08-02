'use strict';

// Photo upload and delivery.
//
// Writing needs the phone's device token, reading needs a browser session, and
// both are scoped to one account. Ownership is per account even though the
// bytes are shared: asking for a photo you don't own is a 404 whether or not
// the file exists, so one user can't probe another's photos by guessing hashes.

const express = require('express');
const fs = require('fs');
const photos = require('../services/photos');
const requireToken = require('../middleware/auth');
const { requireUser } = require('../middleware/session');

const router = express.Router();

// Raw body rather than multipart: one photo per request, so form-data framing
// would add a parser dependency and buy nothing.
const rawJpeg = express.raw({ type: 'image/jpeg', limit: photos.MAX_BYTES });

router.post('/:hash', requireToken, rawJpeg, (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(415).json({
        error: 'unsupported_media_type',
        message: 'Send the JPEG as the raw body with Content-Type: image/jpeg.',
      });
    }

    const saved = photos.save(req.accountId, req.params.hash, req.body);
    res.json({ ok: true, hash: saved.hash, bytes: saved.bytes });
  } catch (err) {
    if (err.code && err.code !== 'ENOENT') {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

router.get('/:hash', requireUser, (req, res, next) => {
  try {
    const { hash } = req.params;

    if (!photos.has(req.account.id, hash)) {
      return res.status(404).json({ error: 'not_found', message: 'No such photo.' });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    // The name is the content, so a stored photo can never change under a given
    // URL. Private because it's your data, not the cache's.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

    fs.createReadStream(photos.pathFor(hash)).on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
