// Cloudflare Turnstile verification.
//
// Optional by design: the public forms already carry a honeypot, a time-trap
// and per-IP rate limiting. Setting the TURNSTILE_SECRET environment variable
// switches Turnstile on without any code change; leaving it unset skips it.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileEnabled(env) {
  return typeof env.TURNSTILE_SECRET === 'string' && env.TURNSTILE_SECRET.length > 0;
}

/**
 * Verify a Turnstile token. Returns true when the token is good, or when
 * Turnstile is not configured at all.
 */
export async function verifyTurnstile(env, token, ip) {
  if (!turnstileEnabled(env)) return true;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);

  try {
    const response = await fetch(VERIFY_URL, { method: 'POST', body: form });
    if (!response.ok) return false;
    const data = await response.json();
    return data.success === true;
  } catch {
    // Fail closed: if the challenge cannot be verified, do not accept it.
    return false;
  }
}
