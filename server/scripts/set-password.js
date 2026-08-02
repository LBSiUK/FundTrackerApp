#!/usr/bin/env node
'use strict';

// Creates or updates a dashboard login.
//   node scripts/set-password.js you@example.com
//   node scripts/set-password.js you@example.com --admin
//
// --admin grants access to /admin, which is where activation codes are issued.
// The first account on a server needs it: without an admin nobody can create
// codes, and without a code nobody can register.
//
// The password is read from stdin without echoing, so it never appears in
// shell history or the process list.

const readline = require('readline');
const users = require('../services/users');

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

    // Suppress echo while the password is typed.
    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (chunk) => {
      if (!muted) return write(chunk);
      // Keep the prompt itself visible, hide the typed characters.
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

  if (password.length < 12) {
    console.error('Use at least 12 characters — this login will be reachable from the internet.');
    process.exit(1);
  }

  users.setUser(username, password, asAdmin ? { role: 'admin', active: true } : {});
  const account = users.getUser(username);
  console.log(`Password set for "${account.username}" (${account.role}).`);
  console.log(`Stored in ${users.USERS_PATH}`);
  if (account.role === 'admin') {
    console.log('Admin interface: https://<your-domain>/admin');
  }
})();
