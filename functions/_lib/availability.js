// The scheduling engine.
//
// A slot is offered only when all of these hold:
//   1. Bookings are globally enabled.
//   2. It falls inside an active weekly availability rule.
//   3. It is at least CONFIG.minLeadHours away.
//   4. It does not overlap a blackout window.
//   5. It does not overlap an existing pending or confirmed booking
//      (including the buffer either side).
//
// Both the public calendar and the booking endpoint call computeSlots(), so
// what a client is shown and what the server will accept can never drift.

import { CONFIG } from './config.js';
import {
  zonedToUtc, parseIsoDate, addDays, daysBetween, weekdayOf, isoTimeInTz,
} from './time.js';

/** Two half-open intervals overlap. */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export async function loadSettings(db) {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const row of rows.results || []) out[row.key] = row.value;
  return out;
}

export async function isBookingEnabled(db) {
  const settings = await loadSettings(db);
  return settings.booking_enabled !== '0';
}

/**
 * Compute open slots for an inclusive range of calendar dates.
 *
 * @param {D1Database} db
 * @param {string} fromIso "YYYY-MM-DD"
 * @param {string} toIso   "YYYY-MM-DD"
 * @returns {Promise<{days: Record<string, string[]>, timezone, slotMinutes}>}
 */
export async function computeSlots(db, fromIso, toIso) {
  const tz = CONFIG.timezone;
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) throw new Error('Invalid date range.');

  const span = daysBetween(from, to);
  if (span < 0 || span > CONFIG.maxDaysAhead) throw new Error('Date range too wide.');

  const nowSec = Math.floor(Date.now() / 1000);
  const earliest = nowSec + CONFIG.minLeadHours * 3600;
  // Without an upper bound the calendar happily offers — and the booking
  // endpoint accepts — any future date that matches a weekly rule, years out.
  const latest = nowSec + CONFIG.maxDaysAhead * 86400;

  // Bound the query by the actual window, padded a day either side so a
  // booking that starts late on the previous day still blocks an early slot.
  const rangeStart = zonedToUtc(from[0], from[1], from[2], 0, tz) - 86400;
  const rangeEnd = zonedToUtc(to[0], to[1], to[2], 0, tz) + 2 * 86400;

  const [rulesRes, blackoutsRes, bookingsRes] = await Promise.all([
    db.prepare('SELECT weekday, start_min, end_min FROM availability_rules WHERE active = 1').all(),
    db.prepare('SELECT starts_at, ends_at FROM blackouts WHERE ends_at > ? AND starts_at < ?')
      .bind(rangeStart, rangeEnd).all(),
    db.prepare(`SELECT starts_at, ends_at FROM bookings
                WHERE status IN ('pending', 'confirmed') AND ends_at > ? AND starts_at < ?`)
      .bind(rangeStart, rangeEnd).all(),
  ]);

  const rules = rulesRes.results || [];
  const blackouts = blackoutsRes.results || [];
  const booked = bookingsRes.results || [];

  const slotSec = CONFIG.slotMinutes * 60;
  const bufferSec = CONFIG.bufferMinutes * 60;
  const days = {};

  for (let offset = 0; offset <= span; offset++) {
    const [year, month, day] = addDays(from[0], from[1], from[2], offset);
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const weekday = weekdayOf(year, month, day);
    const open = [];

    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;

      // Step by slot + buffer, not slot alone. Back-to-back slots mean every
      // booking's buffer overlaps its neighbours, so a single 90-minute
      // booking with a 30-minute buffer removed three slots from the day.
      // Spacing the grid by the buffer makes a booking cost exactly one slot.
      const step = CONFIG.slotMinutes + CONFIG.bufferMinutes;

      for (let min = rule.start_min; min + CONFIG.slotMinutes <= rule.end_min;
           min += step) {
        const start = zonedToUtc(year, month, day, min, tz);
        const end = start + slotSec;

        if (start < earliest || start > latest) continue;
        if (blackouts.some((b) => overlaps(start, end, b.starts_at, b.ends_at))) continue;
        if (booked.some((b) => overlaps(
          start - bufferSec, end + bufferSec, b.starts_at, b.ends_at))) continue;

        open.push(isoTimeInTz(start, tz));
      }
    }

    if (open.length) {
      // Rules can overlap; de-duplicate and present in order.
      days[iso] = [...new Set(open)].sort();
    }
  }

  return { days, timezone: tz, slotMinutes: CONFIG.slotMinutes };
}

/**
 * Authoritative check that one specific slot can still be booked.
 * Called at submit time so two people racing for the last slot cannot both
 * win, and so a crafted request cannot book a time the calendar never offered.
 */
export async function isSlotBookable(db, dateIso, timeHhmm) {
  const result = await computeSlots(db, dateIso, dateIso);
  return (result.days[dateIso] || []).includes(timeHhmm);
}
