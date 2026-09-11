// Owner session handling.
//
// The session token is random and is never stored: only its SHA-256 hash
// reaches the database, so a database leak cannot be replayed as a login.
// The CSRF token is handled the same way.

import { CONFIG } from './config.js';
import { randomToken, sha256Hex, timingSafeEqualStr, hashIp } from './crypto.js';
import { clientIp, nowSeconds } from './http.js';

// The __Host- prefix pins the cookie to this exact origin with Path=/ and
// forbids a Domain attribute, so a subdomain cannot overwrite it.
export const COOKIE_NAME = '__Host-icflic_session';

function serializeCookie(value, maxAge) {
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export function readCookie(request, name = COOKIE_NAME) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/**
 * Start a session. Returns the Set-Cookie header value and the CSRF token,
 * which the client keeps in memory and echoes on every state-changing call.
 */
export async function createSession(db, request, env) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const now = nowSeconds();

  await db
    .prepare(`INSERT INTO sessions (token_hash, csrf_hash, created_at, expires_at, ip_hash, user_agent)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(
      await sha256Hex(token),
      await sha256Hex(csrf),
      now,
      now + CONFIG.sessionTtl,
      await hashIp(clientIp(request), env.IP_HASH_SALT),
      (request.headers.get('user-agent') || '').slice(0, 200),
    )
    .run();

  return {
    cookie: serializeCookie(token, CONFIG.sessionTtl),
    csrf,
  };
}

/** Look up the session behind a request. Returns the row, or null. */
export async function getSession(db, request) {
  const token = readCookie(request);
  if (!token || token.length !== 64) return null;

  const row = await db
    .prepare('SELECT token_hash, csrf_hash, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first();

  if (!row) return null;

  if (row.expires_at <= nowSeconds()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(row.token_hash).run();
    return null;
  }

  return row;
}

/**
 * Verify the CSRF token a client sent against the one bound to its session.
 * Compared as hashes in constant time.
 */
export async function checkCsrf(session, request) {
  const sent = request.headers.get('x-csrf-token');
  if (!sent || sent.length !== 64) return false;
  return timingSafeEqualStr(await sha256Hex(sent), session.csrf_hash);
}

export async function destroySession(db, request) {
  const token = readCookie(request);
  if (token && token.length === 64) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token)).run();
  }
  return serializeCookie('', 0);
}

/** Drop expired sessions so the table cannot grow without bound. */
export async function sweepSessions(db) {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowSeconds()).run();
}
