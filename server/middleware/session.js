'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'ft_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Signing key for session cookies. Without it, sessions can't be issued at all
// — better to fail closed than to fall back to a predictable default.
const SECRET = process.env.SESSION_SECRET || '';

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/** Stateless signed cookie: no server-side store, so sessions survive restarts. */
function issue(username) {
  const payload = b64url(JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_MS }));
  return `${payload}.${sign(payload)}`;
}

function verify(value) {
  const [payload, signature] = String(value || '').split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

// Secure is set whenever the request arrived over TLS. Behind the tunnel or a
// reverse proxy that's X-Forwarded-Proto, which `trust proxy` resolves for us.
function setCookie(req, res, username) {
  const attributes = [
    `${COOKIE_NAME}=${issue(username)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (req.secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verify(cookies[COOKIE_NAME]);
  return session ? session.u : null;
}

function requireSession(req, res, next) {
  if (!SECRET) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'SESSION_SECRET is not set on the server.',
    });
  }

  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Please sign in.' });
  }

  req.user = user;
  next();
}

/**
 * Admin-only routes. The role is read from users.json on every request rather
 * than baked into the cookie, so demoting or disabling an admin takes effect
 * immediately instead of whenever their 30-day session happens to expire.
 */
function requireAdmin(req, res, next) {
  requireSession(req, res, () => {
    // Required lazily: services/users pulls in this file's siblings, and a
    // top-level require here would be circular.
    const users = require('../services/users');
    const account = users.getUser(req.user);

    if (!account || !account.active || account.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden', message: 'Admin access required.' });
    }

    req.account = account;
    next();
  });
}

module.exports = {
  requireSession,
  requireAdmin,
  setCookie,
  clearCookie,
  currentUser,
  hasSecret: () => Boolean(SECRET),
};
