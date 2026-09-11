#!/usr/bin/env node
/**
 * Generate the OWNER_PASSWORD_HASH value for the owner sign-in.
 *
 *   npm run owner:hash -- "a long passphrase you will remember"
 *
 * Paste the output into Cloudflare Pages as an *encrypted* environment
 * variable named OWNER_PASSWORD_HASH, and into .dev.vars for local work.
 * The plaintext password is never stored anywhere.
 */

import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 210000;

const password = process.argv.slice(2).join(' ');

if (!password) {
  console.error('Usage: npm run owner:hash -- "your passphrase"');
  process.exit(1);
}

if (password.length < 12) {
  console.error('Use at least 12 characters. A memorable four-word phrase beats a short scramble.');
  process.exit(1);
}

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));

const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256,
);

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const hash = `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;

console.log('\nOWNER_PASSWORD_HASH:\n');
console.log(hash);
console.log('\nAdd it as an encrypted variable in the Cloudflare Pages dashboard,');
console.log('and to .dev.vars for local development. Do not commit .dev.vars.\n');
