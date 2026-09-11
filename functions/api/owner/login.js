// POST /api/owner/login
//
// There is exactly one owner account and no sign-up. The credentials live in
// Cloudflare Secrets (OWNER_EMAIL, OWNER_PASSWORD_HASH), so the database
// holds no password material at all.

import { CONFIG } from '../../_lib/config.js';
import { ok, fail, readJson, isSameOrigin, clientIp } from '../../_lib/http.js';
import { verifyPassword, hashIp, timingSafeEqualStr } from '../../_lib/crypto.js';
import { consume, lock, clear } from '../../_lib/ratelimit.js';
import { createSession, sweepSessions } from '../../_lib/session.js';
import { clean } from '../../_lib/validate.js';

// Deliberately vague: never reveal whether the email or the password was wrong.
const REJECTED = 'Incorrect email or password.';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return fail('Request rejected.', 403);

  if (!env.OWNER_EMAIL || !env.OWNER_PASSWORD_HASH) {
    console.error('OWNER_EMAIL or OWNER_PASSWORD_HASH is not configured');
    return fail('Sign-in is not configured yet.', 503);
  }

  const body = await readJson(request);
  if (!body) return fail('Malformed request.', 400);

  const email = clean(body.email, 200).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  const ipHash = await hashIp(clientIp(request), env.IP_HASH_SALT);
  const [max, windowSeconds] = CONFIG.limits.login;

  // Per-IP throttle, so one host cannot grind through a dictionary.
  const ipLimit = await consume(env.DB, `login-ip:${ipHash}`, max, windowSeconds);
  if (!ipLimit.allowed) {
    return fail('Too many attempts. Please wait and try again.', 429,
      { retryAfter: ipLimit.retryAfter });
  }

  // Per-account lockout, so a distributed attempt still stalls.
  const accountKey = 'login-account';
  const accountLimit = await consume(env.DB, accountKey,
    CONFIG.loginLockAfter, CONFIG.loginLockSeconds);
  if (!accountLimit.allowed) {
    return fail('This account is temporarily locked. Please wait and try again.', 429,
      { retryAfter: accountLimit.retryAfter });
  }

  // Always run both comparisons so a wrong email is not faster than a wrong
  // password. Neither result short-circuits the other.
  const emailMatches = timingSafeEqualStr(email, env.OWNER_EMAIL.trim().toLowerCase());
  const passwordMatches = await verifyPassword(password, env.OWNER_PASSWORD_HASH);

  if (!emailMatches || !passwordMatches) {
    if (accountLimit.remaining <= 0) {
      await lock(env.DB, accountKey, CONFIG.loginLockSeconds);
    }
    return fail(REJECTED, 401);
  }

  // Success: clear the counters and mint a session.
  await clear(env.DB, accountKey);
  await clear(env.DB, `login-ip:${ipHash}`);
  await sweepSessions(env.DB);

  try {
    const { cookie, csrf } = await createSession(env.DB, request, env);
    return ok({ csrf }, { 'set-cookie': cookie });
  } catch (error) {
    console.error('session creation failed', error);
    return fail('Could not start a session. Please try again.', 500);
  }
}
