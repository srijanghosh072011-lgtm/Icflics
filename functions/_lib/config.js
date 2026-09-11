// Site-wide server configuration.
// Anything secret belongs in Cloudflare Secrets, never in this file.

export const CONFIG = {
  // IANA timezone the studio operates in. All calendar slots are computed
  // against this, so a client in another timezone still books the right hour.
  timezone: 'America/New_York',

  // Session length offered on the public calendar, in minutes.
  slotMinutes: 90,

  // Gap left between the end of one booking and the start of the next.
  bufferMinutes: 30,

  // How far ahead the public calendar looks, and the minimum notice required.
  maxDaysAhead: 120,
  minLeadHours: 24,

  // Session lifetime for the owner panel, in seconds (8 hours).
  sessionTtl: 8 * 60 * 60,

  // PBKDF2 work factor. See docs/SECURITY-NOTES.md for why PBKDF2 rather
  // than bcrypt or argon2 on this runtime.
  pbkdf2Iterations: 210000,

  // Rate limits: [maxRequests, windowSeconds].
  limits: {
    booking: [5, 3600],      // 5 booking requests per IP per hour
    contact: [5, 3600],      // 5 messages per IP per hour
    login: [8, 900],         // 8 sign-in attempts per IP per 15 minutes
  },

  // Consecutive failed sign-ins before the account locks, and for how long.
  loginLockAfter: 5,
  loginLockSeconds: 900,
};
