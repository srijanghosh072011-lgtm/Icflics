// Server-side input validation.
//
// Every field a client can send is validated here before it reaches the
// database. Nothing is trusted because the browser also checked it.

// Control characters that have no business in a form field.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Collapse whitespace, strip control characters, and cap the length. */
export function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Same as clean() but preserves paragraph breaks, for message bodies. */
export function cleanMultiline(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/**
 * Pragmatic email check. Deliberately not RFC 5322 — the only authoritative
 * test is whether mail to it arrives, so this rejects the obviously broken
 * and lets everything else through.
 */
export function isEmail(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 6 || value.length > 200) return false;
  if (/\s/.test(value)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(value);
}

/** Reject anything that looks like an injected mail header. */
export function hasHeaderInjection(value) {
  return typeof value === 'string' && /[\r\n]|%0[ad]/i.test(value);
}

/**
 * Cheap spam heuristics for public forms. Real filtering happens through the
 * rate limiter and Turnstile; this catches the low-effort majority.
 */
export function looksLikeSpam(text) {
  if (typeof text !== 'string' || !text) return false;
  const links = (text.match(/https?:\/\//gi) || []).length;
  if (links >= 4) return true;
  if (/\b(viagra|casino|crypto\s*giveaway|seo\s*services|backlinks?)\b/i.test(text)) return true;
  // A wall of text with no spaces is machine-generated, not a person.
  if (/\S{120,}/.test(text)) return true;
  return false;
}

const PACKAGES = new Set(['', 'recruiting', 'matchday', 'portraits', 'brand']);
export function isPackageId(value) {
  return PACKAGES.has(typeof value === 'string' ? value : '');
}

const STATUSES = new Set(['pending', 'confirmed', 'declined', 'cancelled']);
export function isBookingStatus(value) {
  return STATUSES.has(value);
}

/**
 * Honeypot plus time-trap.
 * A filled honeypot is a bot. A form submitted in under three seconds was not
 * filled in by a human who read it.
 */
export function failsBotChecks(body, minSeconds = 3) {
  if (clean(body.website, 100) !== '') return true;
  const elapsed = Number(body.elapsed);
  if (!Number.isFinite(elapsed) || elapsed < minSeconds * 1000) return true;
  return false;
}

/** Generate a short, human-quotable booking reference. */
export function makeReference() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `ICF-${out}`;
}
