'use strict';

const express      = require('express');
const path         = require('path');
const fundRouter    = require('./routes/fund');
const authRouter    = require('./routes/auth');
const devicesRouter = require('./routes/devices');
const photosRouter  = require('./routes/photos');
const adminRouter   = require('./routes/admin');
const users        = require('./services/users');
const session      = require('./middleware/session');
const errorHandler = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3100;

// Behind the tunnel/reverse proxy, so req.secure and req.ip come from the
// X-Forwarded-* headers rather than the local socket.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Snapshots are small, but a phone with a long history shouldn't hit the
// default 100kb body limit.
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Everything is served from this origin; no external scripts, styles or frames.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  next();
});

// /admin is a page, not a directory. The API behind it is what's guarded —
// serving the shell to anyone costs nothing and keeps the routing obvious.
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(express.static('public'));

// Unauthenticated, so the dashboard can tell "server down" from "signed out",
// and so the iOS app can check a server address during onboarding before it
// asks you for a password. `service` is what makes that check meaningful: a 200
// from some unrelated host isn't proof you typed the right address.
//
// `setupRequired` lets the app say "this server has no accounts yet" instead of
// bouncing you off a sign-in that could never succeed.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'fundtracker',
    setupRequired: !users.hasAnyUser(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/photos', photosRouter);
app.use('/api/admin', adminRouter);
app.use('/api', fundRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`FundTracker dashboard running at http://localhost:${PORT}`);
  if (!session.hasSecret()) {
    console.warn('WARNING: SESSION_SECRET is not set — nobody will be able to sign in.');
  }
  if (!users.hasAnyUser()) {
    console.warn('WARNING: no logins yet — run `node scripts/set-password.js <email> --admin`.');
    console.warn('         Until then nobody can sign in and no codes can be issued.');
  } else if (users.countAdmins() === 0) {
    console.warn('WARNING: no admin account — /admin is unreachable and no activation');
    console.warn('         codes can be issued. Run `node scripts/set-password.js <email> --admin`.');
  }
  if (process.env.FUNDTRACKER_TOKEN) {
    console.warn('NOTE: FUNDTRACKER_TOKEN is set. That shared token still works, but the');
    console.warn('      app now signs in and gets its own device token. Once every device');
    console.warn('      has done so, remove it from .env.');
  }
});
