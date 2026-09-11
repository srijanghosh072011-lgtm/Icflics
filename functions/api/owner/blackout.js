// POST /api/owner/blackout — add or remove a blackout window.
//
// A blackout is the fine-grained version of the master switch: a weekend away,
// an exam week, a fixture already committed to. Anything overlapping one
// disappears from the public calendar.

import { CONFIG } from '../../_lib/config.js';
import { ok, fail, readJson, nowSeconds } from '../../_lib/http.js';
import { requireOwner } from '../../_lib/auth.js';
import { parseIsoDate, parseIsoTime, zonedToUtc, formatSlot } from '../../_lib/time.js';
import { clean } from '../../_lib/validate.js';

const MAX_BLACKOUT_DAYS = 366;

export async function onRequestPost(context) {
  const guard = await requireOwner(context);
  if (guard.response) return guard.response;

  const body = await readJson(context.request);
  if (!body) return fail('Malformed request.', 400);

  const { env } = context;

  if (body.action === 'delete') {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return fail('Invalid blackout id.', 400);
    try {
      await env.DB.prepare('DELETE FROM blackouts WHERE id = ?').bind(id).run();
      return ok({ deleted: id });
    } catch (error) {
      console.error('blackout delete failed', error);
      return fail('Could not remove the blackout.', 500);
    }
  }

  if (body.action !== 'add') return fail('Unknown action.', 400);

  const startDate = parseIsoDate(body.startDate);
  const endDate = parseIsoDate(body.endDate);
  if (!startDate || !endDate) return fail('Provide valid start and end dates.', 400);

  // Blank times mean the whole day: midnight to midnight.
  const startMin = body.startTime ? parseIsoTime(body.startTime) : 0;
  const endMin = body.endTime ? parseIsoTime(body.endTime) : 0;
  if (startMin === null || endMin === null) return fail('Provide valid times.', 400);

  const tz = CONFIG.timezone;
  const startsAt = zonedToUtc(startDate[0], startDate[1], startDate[2], startMin, tz);
  // An end time of 00:00 means the end of that day, not the start of it.
  const endsAt = body.endTime
    ? zonedToUtc(endDate[0], endDate[1], endDate[2], endMin, tz)
    : zonedToUtc(endDate[0], endDate[1], endDate[2], 0, tz) + 86400;

  if (endsAt <= startsAt) return fail('The end must come after the start.', 400);
  if (endsAt - startsAt > MAX_BLACKOUT_DAYS * 86400) {
    return fail(`A blackout cannot span more than ${MAX_BLACKOUT_DAYS} days.`, 400);
  }

  const reason = clean(body.reason, 200);

  try {
    const result = await env.DB
      .prepare('INSERT INTO blackouts (starts_at, ends_at, reason, created_at) VALUES (?, ?, ?, ?)')
      .bind(startsAt, endsAt, reason, nowSeconds())
      .run();

    // Warn rather than block: the owner may deliberately be blocking a day
    // they have already accepted a booking for.
    const clash = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM bookings
                WHERE status IN ('pending','confirmed') AND ends_at > ? AND starts_at < ?`)
      .bind(startsAt, endsAt)
      .first();

    return ok({
      id: result.meta?.last_row_id,
      startLabel: formatSlot(startsAt, tz),
      endLabel: formatSlot(endsAt, tz),
      clashes: clash?.n || 0,
    });
  } catch (error) {
    console.error('blackout add failed', error);
    return fail('Could not save the blackout.', 500);
  }
}
