'use strict';

const crypto = require('crypto');

const TOKEN = process.env.FUNDTRACKER_TOKEN || '';

// Constant-time compare so a wrong token can't be guessed byte by byte from timing.
function tokensMatch(supplied) {
  const a = Buffer.from(supplied);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = function requireToken(req, res, next) {
  if (!TOKEN) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'FUNDTRACKER_TOKEN is not set on the server.',
    });
  }

  const header = req.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!supplied || !tokensMatch(supplied)) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid token.',
    });
  }

  next();
};
