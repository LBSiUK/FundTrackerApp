'use strict';

const express      = require('express');
const path         = require('path');
const fundRouter    = require('./routes/fund');
const authRouter    = require('./routes/auth');
const devicesRouter = require('./routes/devices');
const photosRouter  = require('./routes/photos');
const adminRouter   = require('./routes/admin');
const accounts     = require('./services/accounts');
const bootstrap    = require('./services/bootstrap');
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
    // Registration is closed and an admin always exists after bootstrap, so
    // there is no "set me up" state left to report. Kept for older app builds
    // that read the field.
    setupRequired: false,
  });
});

app.use('/api/auth', authRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/photos', photosRouter);
app.use('/api/admin', adminRouter);
app.use('/api', fundRouter);

app.use(errorHandler);

bootstrap.run({ log: (line) => console.log(`[bootstrap] ${line}`) });

app.listen(PORT, () => {
  console.log(`FundTracker dashboard running at http://localhost:${PORT}`);
  if (!session.hasSecret()) {
    console.warn('WARNING: SESSION_SECRET is not set — nobody will be able to sign in.');
  }
  console.log(`Accounts: ${accounts.count()}, active admins: ${accounts.countAdmins()}.`);

  if (process.env.FUNDTRACKER_TOKEN) {
    console.warn('NOTE: FUNDTRACKER_TOKEN is set but no longer does anything. Sync is now');
    console.warn('      per-account, and a server-wide token has no account to attribute');
    console.warn('      a sync to. Remove it from .env.');
  }
});
