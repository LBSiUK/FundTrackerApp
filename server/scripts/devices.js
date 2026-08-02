#!/usr/bin/env node
'use strict';

// Lists or revokes the phones allowed to sync.
//
//   node scripts/devices.js list
//   node scripts/devices.js revoke <id>
//
// Revoking is immediate: the next sync from that phone gets a 401 and the app
// drops back to its sign-in screen.

const devices = require('../services/devices');

const [command, argument] = process.argv.slice(2);

function usage() {
  console.error('Usage: node scripts/devices.js list');
  console.error('       node scripts/devices.js revoke <id>');
  process.exit(1);
}

if (command === 'list') {
  const all = devices.list();

  if (all.length === 0) {
    console.log('No devices have signed in yet.');
    process.exit(0);
  }

  for (const device of all) {
    const seen = device.lastSeenAt ? `last synced ${device.lastSeenAt}` : 'never synced';
    console.log(`${device.id}  ${device.name}  (${device.user}, ${seen})`);
  }
} else if (command === 'revoke') {
  if (!argument) usage();

  if (devices.revoke(argument)) {
    console.log(`Revoked ${argument}.`);
  } else {
    console.error(`No device with id ${argument}.`);
    process.exit(1);
  }
} else {
  usage();
}
