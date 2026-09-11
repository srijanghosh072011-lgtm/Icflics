// Fixed-window rate limiting backed by D1.
//
// Not distributed-perfect, but a single Pages project talks to a single D1
// instance, and a fixed window is enough to stop form flooding and password
// guessing without adding another moving part.

import { nowSeconds } from './http.js';

/**
 * Consume one unit against `key`.
 * Returns { allowed, remaining, retryAfter }.
 */
export async function consume(db, key, max, windowSeconds) {
  const now = nowSeconds();

  const row = await db
    .prepare('SELECT count, window_start, locked_until FROM rate_limits WHERE key = ?')
    .bind(key)
    .first();

  if (row && row.locked_until > now) {
    return { allowed: false, remaining: 0, retryAfter: row.locked_until - now };
  }

  // Window expired (or never existed): start a fresh one.
  if (!row || now - row.window_start >= windowSeconds) {
    await db
      .prepare(`INSERT INTO rate_limits (key, count, window_start, locked_until)
                VALUES (?, 1, ?, 0)
                ON CONFLICT(key) DO UPDATE SET count = 1, window_start = ?, locked_until = 0`)
      .bind(key, now, now)
      .run();
    return { allowed: true, remaining: max - 1, retryAfter: 0 };
  }

  if (row.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: row.window_start + windowSeconds - now,
    };
  }

  await db
    .prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?')
    .bind(key)
    .run();

  return { allowed: true, remaining: max - row.count - 1, retryAfter: 0 };
}

/** Lock a key outright, used after repeated failed sign-ins. */
export async function lock(db, key, seconds) {
  const now = nowSeconds();
  await db
    .prepare(`INSERT INTO rate_limits (key, count, window_start, locked_until)
              VALUES (?, 0, ?, ?)
              ON CONFLICT(key) DO UPDATE SET locked_until = ?`)
    .bind(key, now, now + seconds, now + seconds)
    .run();
}

export async function clear(db, key) {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}

/** Drop expired rows so the table cannot grow without bound. */
export async function sweep(db, olderThanSeconds = 86400) {
  const now = nowSeconds();
  await db
    .prepare('DELETE FROM rate_limits WHERE window_start < ? AND locked_until < ?')
    .bind(now - olderThanSeconds, now)
    .run();
}
