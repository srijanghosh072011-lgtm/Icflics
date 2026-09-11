// POST /api/owner/booking — confirm, decline or cancel a request.

import { ok, fail, readJson, nowSeconds } from '../../_lib/http.js';
import { requireOwner } from '../../_lib/auth.js';
import { isBookingStatus } from '../../_lib/validate.js';

export async function onRequestPost(context) {
  const guard = await requireOwner(context);
  if (guard.response) return guard.response;

  const body = await readJson(context.request);
  if (!body) return fail('Malformed request.', 400);

  const id = typeof body.id === 'string' ? body.id : '';
  if (id.length < 8 || id.length > 64) return fail('Invalid booking id.', 400);
  if (!isBookingStatus(body.status)) return fail('Unknown status.', 400);

  try {
    const result = await context.env.DB
      .prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?')
      .bind(body.status, nowSeconds(), id)
      .run();

    if (!result.meta?.changes) return fail('That booking no longer exists.', 404);
    return ok({ id, status: body.status });
  } catch (error) {
    console.error('booking status update failed', error);
    return fail('Could not update the booking.', 500);
  }
}
