// GET /api/owner/state — everything the owner panel renders, in one call.
//
// One round trip keeps the client simple: no request waterfall, no partial
// states to reconcile.

import { CONFIG } from '../../_lib/config.js';
import { ok, fail, nowSeconds } from '../../_lib/http.js';
import { requireOwner } from '../../_lib/auth.js';
import { loadSettings } from '../../_lib/availability.js';
import { sweep } from '../../_lib/ratelimit.js';
import { sweepSessions } from '../../_lib/session.js';
import { formatSlot, isoDateInTz, isoTimeInTz } from '../../_lib/time.js';

export async function onRequestGet(context) {
  const guard = await requireOwner(context);
  if (guard.response) return guard.response;

  const { env } = context;
  const tz = CONFIG.timezone;

  try {
    // Housekeeping on an authenticated request rather than a cron job.
    await Promise.all([sweep(env.DB), sweepSessions(env.DB)]);

    const horizon = nowSeconds() - 90 * 86400;

    const [bookingsRes, blackoutsRes, rulesRes, messagesRes] = await Promise.all([
      env.DB.prepare(
        `SELECT id, reference, name, email, phone, sport, package_id, location,
                message, starts_at, ends_at, status, created_at
         FROM bookings WHERE starts_at > ? ORDER BY starts_at ASC LIMIT 500`,
      ).bind(horizon).all(),
      env.DB.prepare(
        'SELECT id, starts_at, ends_at, reason FROM blackouts WHERE ends_at > ? ORDER BY starts_at ASC LIMIT 200',
      ).bind(nowSeconds() - 86400).all(),
      env.DB.prepare(
        'SELECT id, weekday, start_min, end_min, active FROM availability_rules ORDER BY weekday, start_min',
      ).all(),
      env.DB.prepare(
        'SELECT id, name, email, body, handled, created_at FROM messages ORDER BY created_at DESC LIMIT 200',
      ).all(),
    ]);

    const settings = await loadSettings(env.DB);

    const bookings = (bookingsRes.results || []).map((b) => ({
      ...b,
      date: isoDateInTz(b.starts_at, tz),
      time: isoTimeInTz(b.starts_at, tz),
      label: formatSlot(b.starts_at, tz),
    }));

    const blackouts = (blackoutsRes.results || []).map((b) => ({
      ...b,
      startLabel: formatSlot(b.starts_at, tz),
      endLabel: formatSlot(b.ends_at, tz),
      startDate: isoDateInTz(b.starts_at, tz),
      startTime: isoTimeInTz(b.starts_at, tz),
      endDate: isoDateInTz(b.ends_at, tz),
      endTime: isoTimeInTz(b.ends_at, tz),
    }));

    return ok({
      timezone: tz,
      slotMinutes: CONFIG.slotMinutes,
      settings: {
        bookingEnabled: settings.booking_enabled !== '0',
        pausedMessage: settings.booking_paused_message || '',
      },
      bookings,
      blackouts,
      rules: rulesRes.results || [],
      messages: messagesRes.results || [],
    });
  } catch (error) {
    console.error('owner state failed', error);
    return fail('Could not load the panel data.', 500);
  }
}
