// POST /api/bookings — create a booking request.
//
// Public and unauthenticated, so it is defended in depth: honeypot, time-trap,
// same-origin check, per-IP rate limit, optional Turnstile, strict validation,
// and an authoritative re-check that the requested slot is genuinely open.

import { CONFIG } from '../_lib/config.js';
import { ok, fail, readJson, isSameOrigin, clientIp, nowSeconds } from '../_lib/http.js';
import { hashIp } from '../_lib/crypto.js';
import { consume } from '../_lib/ratelimit.js';
import { isSlotBookable, loadSettings } from '../_lib/availability.js';
import { zonedToUtc, parseIsoDate, parseIsoTime, formatSlot } from '../_lib/time.js';
import { verifyTurnstile } from '../_lib/turnstile.js';
import {
  clean, cleanMultiline, isEmail, hasHeaderInjection, looksLikeSpam,
  isPackageId, failsBotChecks, makeReference,
} from '../_lib/validate.js';

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) {
    return fail('Request rejected.', 403);
  }

  const body = await readJson(request);
  if (!body) return fail('Malformed request.', 400);

  // Honeypot + time-trap. Answer exactly as if it succeeded so a bot gets no
  // signal about why it was dropped.
  if (failsBotChecks(body)) {
    return ok({ reference: makeReference() });
  }

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);

  const [max, windowSeconds] = CONFIG.limits.booking;
  const limit = await consume(env.DB, `book:${ipHash}`, max, windowSeconds);
  if (!limit.allowed) {
    return fail('Too many requests. Please try again later.', 429,
      { retryAfter: limit.retryAfter });
  }

  if (!await verifyTurnstile(env, body.turnstileToken, ip)) {
    return fail('Verification failed. Please reload the page and try again.', 400);
  }

  // ---- Validation ---------------------------------------------------------
  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 40);
  const sport = clean(body.sport, 60);
  const packageId = clean(body.package, 40);
  const location = clean(body.location, 200);
  const message = cleanMultiline(body.message, 2000);

  if (name.length < 2) return fail('Please enter your name.', 400, { field: 'name' });
  if (!isEmail(email)) return fail('Please enter a valid email address.', 400, { field: 'email' });
  if (hasHeaderInjection(name) || hasHeaderInjection(email)) {
    return fail('Request rejected.', 400);
  }
  if (!isPackageId(packageId)) return fail('Unknown package.', 400, { field: 'package' });
  if (looksLikeSpam(message) || looksLikeSpam(location)) {
    // Accept silently rather than teaching a spammer what tripped the filter.
    return ok({ reference: makeReference() });
  }

  const date = parseIsoDate(body.date);
  const minutes = parseIsoTime(body.time);
  if (!date || minutes === null) {
    return fail('Please choose a date and time.', 400, { field: 'date' });
  }

  // ---- Availability -------------------------------------------------------
  try {
    const settings = await loadSettings(env.DB);
    if (settings.booking_enabled === '0') {
      return fail(settings.booking_paused_message
        || 'Bookings are closed at the moment.', 409);
    }

    // Authoritative re-check: the slot must still be open right now, not just
    // when the calendar was rendered.
    if (!await isSlotBookable(env.DB, body.date, body.time)) {
      return fail('That slot has just been taken. Please pick another.', 409,
        { field: 'date' });
    }

    const startsAt = zonedToUtc(date[0], date[1], date[2], minutes, CONFIG.timezone);
    const endsAt = startsAt + CONFIG.slotMinutes * 60;
    const now = nowSeconds();
    const id = crypto.randomUUID();

    // A reference collision is vanishingly unlikely, but the column is UNIQUE,
    // so retry rather than 500.
    let reference = makeReference();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await env.DB
          .prepare(`INSERT INTO bookings
                    (id, reference, name, email, phone, sport, package_id, location,
                     message, starts_at, ends_at, status, created_at, updated_at, ip_hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
          .bind(id, reference, name, email, phone, sport, packageId, location,
            message, startsAt, endsAt, now, now, ipHash)
          .run();
        break;
      } catch (error) {
        if (attempt === 4 || !String(error).includes('UNIQUE')) throw error;
        reference = makeReference();
      }
    }

    return ok({
      reference,
      slot: formatSlot(startsAt, CONFIG.timezone),
    });
  } catch (error) {
    console.error('booking failed', error);
    return fail('Could not save the request. Please try again.', 500);
  }
}
