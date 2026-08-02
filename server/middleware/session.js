'use strict';

// Signed session cookies.
//
// The cookie carries an **account id**, not a username. That's what lets an
// admin rename an account without signing it out, and it means the role and
// active flag are read fresh from the database on every request rather than
// being frozen at sign-in.

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

/** Stateless signed cookie: no server-side store, so sessions survive a restart. */
function issue(accountId) {
  const payload = b64url(JSON.stringify({ a: accountId, exp: Date.now() + MAX_AGE_MS }));
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

// Secure is set whenever the request arrived over TLS. Behind Caddy that's
// X-Forwarded-Proto, which `trust proxy` resolves for us.
function setCookie(req, res, accountId) {
  const attributes = [
    `${COOKIE_NAME}=${issue(accountId)}`,
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

/** The account this request belongs to, straight from the database, or null. */
function currentAccount(req) {
  // Required lazily to keep the module graph acyclic.
  const accounts = require('../services/accounts');
  const cookies = parseCookies(req.headers.cookie);
  const session = verify(cookies[COOKIE_NAME]);
  if (!session || !session.a) return null;

  const account = accounts.byId(session.a);
  return account && account.active ? account : null;
}

function requireSession(req, res, next) {
  if (!SECRET) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'SESSION_SECRET is not set on the server.',
    });
  }

  const account = currentAccount(req);
  if (!account) {
    return res.status(401).json({ error: 'unauthorized', message: 'Please sign in.' });
  }

  // An account carrying a default or reset password can reach the
  // change-password endpoint and nothing else. Enforced here so no individual
  // route has to remember to check.
  if (account.mustChangePassword && !req.path.startsWith('/change-password')) {
    return res.status(428).json({
      error: 'password_change_required',
      message: 'Set a new password before continuing.',
    });
  }

  req.account = account;
  next();
}

/**
 * Fund data, and nothing else. Admins are deliberately excluded: the admin
 * account manages the server rather than using it, and has no records of its
 * own to look at.
 */
function requireUser(req, res, next) {
  requireSession(req, res, () => {
    if (req.account.role === 'admin') {
      return res.status(403).json({
        error: 'admin_has_no_fund',
        message: 'The admin account manages accounts, not fund data. Sign in as a user.',
      });
    }
    next();
  });
}

function requireAdmin(req, res, next) {
  requireSession(req, res, () => {
    if (req.account.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden', message: 'Admin access required.' });
    }
    next();
  });
}

module.exports = {
  requireSession,
  requireUser,
  requireAdmin,
  setCookie,
  clearCookie,
  currentAccount,
  hasSecret: () => Boolean(SECRET),
};
