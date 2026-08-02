#!/usr/bin/env node
'use strict';

// Lists or removes dashboard logins.
//
//   node scripts/users.js list
//   node scripts/users.js delete <username>
//
// Use scripts/set-password.js to create one or change a password.
//
// Deleting a login also revokes every device token issued to it — otherwise a
// phone that signed in as that account would keep syncing after the account it
// authenticated as had gone.

const users = require('../services/users');
const devices = require('../services/devices');

const [command, argument] = process.argv.slice(2);

function usage() {
  console.error('Usage: node scripts/users.js list');
  console.error('       node scripts/users.js delete <username>');
  process.exit(1);
}

if (command === 'list') {
  const all = users.listUsers();

  if (all.length === 0) {
    console.log('No logins yet — run `node scripts/set-password.js <email>`.');
    process.exit(0);
  }

  for (const name of all) console.log(name);
} else if (command === 'delete') {
  if (!argument) usage();

  if (!users.deleteUser(argument)) {
    console.error(`No login called "${String(argument).toLowerCase()}".`);
    process.exit(1);
  }

  const revoked = devices.revokeAllForUser(argument);
  console.log(`Deleted "${String(argument).toLowerCase()}".`);
  if (revoked > 0) {
    console.log(`Also revoked ${revoked} device token${revoked === 1 ? '' : 's'}.`);
  }

  if (!users.hasAnyUser()) {
    console.warn('WARNING: no logins remain — nobody can sign in to the dashboard.');
  }
} else {
  usage();
}
