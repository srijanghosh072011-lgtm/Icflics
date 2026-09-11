// POST /api/owner/settings
//
// The master booking switch. Flipping bookingEnabled to false is the
// "not taking bookings right now" control: the calendar stops offering slots
// and the booking endpoint refuses new requests.

import { ok, fail, readJson, nowSeconds } from '../../_lib/http.js';
import { requireOwner } from '../../_lib/auth.js';
import { cleanMultiline } from '../../_lib/validate.js';

export async function onRequestPost(context) {
  const guard = await requireOwner(context);
  if (guard.response) return guard.response;

  const body = await readJson(context.request);
  if (!body) return fail('Malformed request.', 400);

  if (typeof body.bookingEnabled !== 'boolean') {
    return fail('bookingEnabled must be true or false.', 400);
  }

  const pausedMessage = cleanMultiline(body.pausedMessage, 500)
    || 'Bookings are closed at the moment.';

  try {
    const now = nowSeconds();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('booking_enabled', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(body.bookingEnabled ? '1' : '0', now),
      context.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('booking_paused_message', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(pausedMessage, now),
    ]);

    return ok({ bookingEnabled: body.bookingEnabled, pausedMessage });
  } catch (error) {
    console.error('settings update failed', error);
    return fail('Could not save settings.', 500);
  }
}
