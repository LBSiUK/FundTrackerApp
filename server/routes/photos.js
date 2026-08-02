'use strict';

// Photo upload and delivery.
//
// Same split as everything else: writing needs the phone's device token,
// reading needs a browser session. A token lifted off a phone can add photos
// but still can't look at any.

const express = require('express');
const fs = require('fs');
const photos = require('../services/photos');
const requireToken = require('../middleware/auth');
const { requireSession } = require('../middleware/session');

const router = express.Router();

// Raw body rather than multipart: one photo per request, so the form-data
// framing would add a parser dependency and buy nothing.
const rawJpeg = express.raw({ type: 'image/jpeg', limit: photos.MAX_BYTES });

router.post('/:hash', requireToken, rawJpeg, (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(415).json({
        error: 'unsupported_media_type',
        message: 'Send the JPEG as the raw body with Content-Type: image/jpeg.',
      });
    }

    const saved = photos.save(req.params.hash, req.body);
    res.json({ ok: true, hash: saved.hash, bytes: saved.bytes });
  } catch (err) {
    if (err.code && err.code !== 'ENOENT') {
      // save() rejects anything that isn't the JPEG it claims to be.
      return res.status(400).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

router.get('/:hash', requireSession, (req, res, next) => {
  try {
    const { hash } = req.params;

    if (!photos.isValidHash(hash) || !photos.has(hash)) {
      return res.status(404).json({ error: 'not_found', message: 'No such photo.' });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    // The name is the content, so a stored photo can never change under a
    // given URL. Safe to cache hard, and private because it's your data.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

    fs.createReadStream(photos.pathFor(hash))
      .on('error', next)
      .pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
