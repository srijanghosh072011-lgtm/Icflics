// Timezone handling for the booking calendar.
//
// Slots are authored in the studio's local wall-clock time but stored as UTC
// epoch seconds, so a client booking from another timezone still lands on the
// right hour and daylight-saving transitions do not shift anything.

/**
 * Seconds that the given instant's wall-clock time in `tz` is ahead of UTC.
 * Works by formatting the instant in the zone and reading the result back.
 */
function offsetSeconds(dateMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(dateMs));
  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
  let hour = get('hour');
  if (hour === 24) hour = 0; // some ICU builds report midnight as 24
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'),
    hour, get('minute'), get('second'));
  return (asUtc - dateMs) / 1000;
}

/**
 * Convert a wall-clock time in `tz` to UTC epoch seconds.
 * Two passes so the offset is correct across a DST boundary.
 */
export function zonedToUtc(year, month, day, minutesFromMidnight, tz) {
  const naive = Date.UTC(year, month - 1, day,
    Math.floor(minutesFromMidnight / 60), minutesFromMidnight % 60, 0);
  let ms = naive - offsetSeconds(naive, tz) * 1000;
  ms = naive - offsetSeconds(ms, tz) * 1000;
  return Math.floor(ms / 1000);
}

/** Calendar parts of an instant as seen in `tz`. */
export function zonedParts(epochSeconds, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(epochSeconds * 1000));
  const get = (type) => parts.find((p) => p.type === type).value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour,
    minute: parseInt(get('minute'), 10),
    weekday: weekdays[get('weekday')],
  };
}

/** "YYYY-MM-DD" for an instant, as seen in `tz`. */
export function isoDateInTz(epochSeconds, tz) {
  const p = zonedParts(epochSeconds, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "HH:MM" (24-hour) for an instant, as seen in `tz`. */
export function isoTimeInTz(epochSeconds, tz) {
  const p = zonedParts(epochSeconds, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Parse "YYYY-MM-DD" into [year, month, day], or null if malformed. */
export function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [+m[1], +m[2], +m[3]];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible dates such as 2026-02-30.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return [year, month, day];
}

/** Parse "HH:MM" into minutes from midnight, or null if malformed. */
export function parseIsoTime(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [hour, minute] = [+m[1], +m[2]];
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Weekday (0 = Sunday) for a calendar date in `tz`. */
export function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Step a calendar date forward by n days. Returns [y, m, d]. */
export function addDays(year, month, day, n) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + n);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** Whole days between two calendar dates. */
export function daysBetween(a, b) {
  const ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2]);
  return Math.round(ms / 86400000);
}

/** Human-readable slot label, e.g. "Sat 20 Sep 2026, 9:00 AM". */
export function formatSlot(epochSeconds, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(epochSeconds * 1000));
}
