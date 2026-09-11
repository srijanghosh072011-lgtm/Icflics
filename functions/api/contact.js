// POST /api/contact — store a message from the contact form.
//
// Same defences as the booking endpoint. Messages are read by the owner in
// the private panel; nothing is emailed onward from here, so there is no
// mail-header injection surface beyond what validation already blocks.

import { CONFIG } from '../_lib/config.js';
import { ok, fail, readJson, isSameOrigin, clientIp, nowSeconds } from '../_lib/http.js';
import { hashIp } from '../_lib/crypto.js';
import { consume } from '../_lib/ratelimit.js';
import { verifyTurnstile } from '../_lib/turnstile.js';
import {
  clean, cleanMultiline, isEmail, hasHeaderInjection, looksLikeSpam, failsBotChecks,
} from '../_lib/validate.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) {
    return fail('Request rejected.', 403);
  }

  const body = await readJson(request);
  if (!body) return fail('Malformed request.', 400);

  // Bots get a success response, so they learn nothing.
  if (failsBotChecks(body)) return ok();

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);

  const [max, windowSeconds] = CONFIG.limits.contact;
  const limit = await consume(env.DB, `contact:${ipHash}`, max, windowSeconds);
  if (!limit.allowed) {
    return fail('Too many messages. Please try again later.', 429,
      { retryAfter: limit.retryAfter });
  }

  if (!await verifyTurnstile(env, body.turnstileToken, ip)) {
    return fail('Verification failed. Please reload the page and try again.', 400);
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const messageBody = cleanMultiline(body.message, 2000);

  if (name.length < 2) return fail('Please enter your name.', 400, { field: 'name' });
  if (!isEmail(email)) return fail('Please enter a valid email address.', 400, { field: 'email' });
  if (messageBody.length < 10) {
    return fail('Please add a little more detail.', 400, { field: 'message' });
  }
  if (hasHeaderInjection(name) || hasHeaderInjection(email)) {
    return fail('Request rejected.', 400);
  }
  if (looksLikeSpam(messageBody)) return ok();

  try {
    const now = nowSeconds();
    await env.DB
      .prepare(`INSERT INTO messages (id, name, email, body, handled, created_at, ip_hash)
                VALUES (?, ?, ?, ?, 0, ?, ?)`)
      .bind(crypto.randomUUID(), name, email, messageBody, now, ipHash)
      .run();
    return ok();
  } catch (error) {
    console.error('contact failed', error);
    return fail('Could not send the message. Please try again.', 500);
  }
}
