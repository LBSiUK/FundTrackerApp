#!/usr/bin/env node
'use strict';

// Creates or updates an account from the server.
//   node scripts/set-password.js you@example.com
//   node scripts/set-password.js you@example.com --admin
//
// Day-to-day account management lives at /admin. This exists for the case the
// web interface can't help with: no admin can sign in.
//
// The password is read from stdin without echoing, so it never reaches shell
// history or the process list.

const readline = require('readline');
const accounts = require('../services/accounts');

const args = process.argv.slice(2);
const asAdmin = args.includes('--admin');
const username = args.find((arg) => !arg.startsWith('--'));

if (!username) {
  console.error('Usage: node scripts/set-password.js <email> [--admin]');
  process.exit(1);
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (chunk) => {
      if (!muted) return write(chunk);
      if (chunk.includes(question)) return write(chunk);
      return undefined;
    };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

(async () => {
  const password = await prompt('New password: ');
  const confirm = await prompt('Confirm password: ');

  if (password !== confirm) {
    console.error('Passwords did not match.');
    process.exit(1);
  }

  if (password.length < accounts.MIN_PASSWORD) {
    console.error(`Use at least ${accounts.MIN_PASSWORD} characters — this login is reachable from the internet.`);
    process.exit(1);
  }

  const existing = accounts.byUsername(username);
  const account = existing
    ? accounts.setPassword(existing.id, password, { mustChange: false })
    : accounts.create({ username, password, role: asAdmin ? 'admin' : 'user', active: true });

  if (existing && asAdmin && existing.role !== 'admin') accounts.setRole(existing.id, 'admin');

  const final = accounts.byId(account.id);
  console.log(`Password set for "${final.username}" (id ${final.id}, ${final.role}).`);
})();
