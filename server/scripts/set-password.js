#!/usr/bin/env node
'use strict';

// Creates or updates a dashboard login.
//   node scripts/set-password.js leon
//
// The password is read from stdin without echoing, so it never appears in
// shell history or the process list.

const readline = require('readline');
const users = require('../services/users');

const username = process.argv[2];

if (!username) {
  console.error('Usage: node scripts/set-password.js <username>');
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

  users.setUser(username, password);
  console.log(`Password set for "${username.toLowerCase()}".`);
  console.log(`Stored in ${users.USERS_PATH}`);
})();
