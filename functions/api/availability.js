// GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Public, read-only. Returns the open slots the booking calendar renders.

import { CONFIG } from '../_lib/config.js';
import { ok, fail } from '../_lib/http.js';
import { computeSlots, loadSettings } from '../_lib/availability.js';
import { parseIsoDate, daysBetween } from '../_lib/time.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!parseIsoDate(from) || !parseIsoDate(to)) {
    return fail('Provide "from" and "to" as YYYY-MM-DD.', 400);
  }
  const span = daysBetween(parseIsoDate(from), parseIsoDate(to));
  if (span < 0) return fail('"to" must not precede "from".', 400);
  if (span > 62) return fail('Request at most 62 days at a time.', 400);

  try {
    const settings = await loadSettings(env.DB);

    if (settings.booking_enabled === '0') {
      return ok({
        enabled: false,
        message: settings.booking_paused_message
          || 'Bookings are closed at the moment.',
        timezone: CONFIG.timezone,
        slotMinutes: CONFIG.slotMinutes,
        maxDaysAhead: CONFIG.maxDaysAhead,
        days: {},
      });
    }

    const result = await computeSlots(env.DB, from, to);
    return ok({ enabled: true, maxDaysAhead: CONFIG.maxDaysAhead, ...result });
  } catch (error) {
    // Never leak a database error to the client.
    console.error('availability failed', error);
    return fail('Could not load availability. Please try again.', 500);
  }
}
