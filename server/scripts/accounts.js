#!/usr/bin/env node
'use strict';

// Lists accounts and their devices from the server.
//   node scripts/accounts.js list [search]
//   node scripts/accounts.js devices <accountId>
//   node scripts/accounts.js delete <accountId>
//
// Everything here is also in /admin; this is the fallback for when nobody can
// sign in.

const accounts = require('../services/accounts');
const devices = require('../services/devices');

const [command, argument] = process.argv.slice(2);

function usage() {
  console.error('Usage: node scripts/accounts.js list [search]');
  console.error('       node scripts/accounts.js devices <accountId>');
  console.error('       node scripts/accounts.js delete <accountId>');
  process.exit(1);
}

if (command === 'list') {
  const { accounts: rows, total } = accounts.list({ search: argument || '', limit: 200 });
  if (rows.length === 0) {
    console.log('No accounts.');
    process.exit(0);
  }
  for (const row of rows) {
    const flags = [row.role, row.active ? 'active' : 'disabled'];
    if (row.mustChangePassword) flags.push('must-change-password');
    console.log(`${String(row.id).padStart(4)}  ${row.username}  [${flags.join(', ')}]  devices: ${row.deviceCount}`);
  }
  console.log(`\n${rows.length} of ${total} shown.`);
} else if (command === 'devices') {
  if (!argument) usage();
  const list = devices.listForAccount(Number(argument));
  if (list.length === 0) console.log('No devices for that account.');
  for (const device of list) {
    console.log(`${device.id}  ${device.name}  ${device.lastSeenAt ? `last synced ${device.lastSeenAt}` : 'never synced'}`);
  }
} else if (command === 'delete') {
  if (!argument) usage();
  const account = accounts.byId(Number(argument));
  if (!account) {
    console.error('No such account.');
    process.exit(1);
  }
  if (account.role === 'admin' && accounts.countAdmins() <= 1) {
    console.error('That is the only active admin. Promote another first.');
    process.exit(1);
  }
  accounts.remove(account.id);
  console.log(`Deleted "${account.username}" and everything belonging to it.`);
} else {
  usage();
}
