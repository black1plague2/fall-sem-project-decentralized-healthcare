#!/usr/bin/env node
// Generate sign-in passwords for the four actors.
//
//   node scripts/setActorPasswords.js
//
// Writes the plain passwords to scripts/keys/ACTOR_PASSWORDS.txt (git-ignored,
// hand them to the people who need them) and prints the two environment
// variables the server needs: ACTOR_CREDENTIALS (scrypt hashes only) and
// SESSION_SECRET. Put both in .env locally and in the Vercel project settings.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hashPassword, ROLES } = require('../src/services/authService');

function makePassword() {
  // 4 groups of 4 from an unambiguous alphabet, e.g. "k7Qm-Wx2p-..."; ~94 bits
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const groups = [];
  for (let g = 0; g < 4; g += 1) {
    let s = '';
    for (let i = 0; i < 4; i += 1) s += alphabet[crypto.randomInt(alphabet.length)];
    groups.push(s);
  }
  return groups.join('-');
}

const plain = {};
const hashes = {};
for (const role of Object.keys(ROLES)) {
  plain[role] = makePassword();
  hashes[role] = hashPassword(plain[role]);
}

const outDir = path.join(__dirname, 'keys');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'ACTOR_PASSWORDS.txt');
fs.writeFileSync(outFile,
  'Cardano Healthcare Vault sign-in accounts (keep private)\n\n' +
  Object.entries(plain).map(([u, p]) => `${u.padEnd(10)} ${p}`).join('\n') + '\n', { mode: 0o600 });

console.log(`Passwords written to ${outFile}\n`);
console.log(`ACTOR_CREDENTIALS=${JSON.stringify(hashes)}`);
console.log(`SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`);
