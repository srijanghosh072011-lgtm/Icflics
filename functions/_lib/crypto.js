// Password hashing, session tokens and constant-time comparison.
// Everything here uses the WebCrypto API built into the Workers runtime —
// no dependencies, nothing to audit for CVEs.

import { CONFIG } from './config.js';

const enc = new TextEncoder();

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Derive a PBKDF2-HMAC-SHA256 key. Returns raw bytes. */
async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256,
  );
  return new Uint8Array(bits);
}

/** Produce a storable hash string: pbkdf2$<iterations>$<salt>$<hash> */
export async function hashPassword(password, iterations = CONFIG.pbkdf2Iterations) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Verify a password against a stored hash.
 * Always performs the full derivation so timing does not reveal whether the
 * stored hash was well-formed.
 */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid = parts.length === 4 && parts[0] === 'pbkdf2';

  const iterations = valid ? parseInt(parts[1], 10) : CONFIG.pbkdf2Iterations;
  let salt;
  let expected;
  try {
    salt = valid ? fromBase64(parts[2]) : new Uint8Array(16);
    expected = valid ? fromBase64(parts[3]) : new Uint8Array(32);
  } catch {
    salt = new Uint8Array(16);
    expected = new Uint8Array(32);
  }

  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 2000000) {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  return valid && timingSafeEqual(actual, expected);
}

/** Constant-time byte comparison. */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time string comparison, for CSRF and session tokens. */
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

/**
 * Irreversibly hash a client IP for abuse tracking.
 * The raw address is never stored — see the privacy policy.
 */
export async function hashIp(ip, salt) {
  return sha256Hex(`${salt || 'icflic'}::${ip || 'unknown'}`);
}
