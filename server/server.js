'use strict';

const express      = require('express');
const fundRouter   = require('./routes/fund');
const authRouter   = require('./routes/auth');
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

app.use(express.static('public'));

// Unauthenticated, so the dashboard can tell "server down" from "signed out".
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'fundtracker' });
});

app.use('/api/auth', authRouter);
app.use('/api', fundRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`FundTracker dashboard running at http://localhost:${PORT}`);
  if (!process.env.FUNDTRACKER_TOKEN) {
    console.warn('WARNING: FUNDTRACKER_TOKEN is not set — the app will not be able to sync.');
  }
  if (!session.hasSecret()) {
    console.warn('WARNING: SESSION_SECRET is not set — nobody will be able to sign in.');
  }
  if (!users.hasAnyUser()) {
    console.warn('WARNING: no users yet — run `node scripts/set-password.js <username>`.');
  }
});
