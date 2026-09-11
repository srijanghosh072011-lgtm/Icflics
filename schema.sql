-- Icflic booking database (Cloudflare D1 / SQLite)
-- Apply locally:  npm run db:init
-- Apply remotely: npm run db:init:remote

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Owner sessions. The owner's credentials live in Cloudflare Secrets, not here,
-- so a database leak never exposes a password hash.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,            -- SHA-256 of the session token
  csrf_hash   TEXT NOT NULL,               -- SHA-256 of the CSRF token
  created_at  INTEGER NOT NULL,            -- unix seconds
  expires_at  INTEGER NOT NULL,            -- unix seconds
  ip_hash     TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Weekly recurring availability, expressed in the studio's local timezone.
-- weekday: 0 = Sunday .. 6 = Saturday. start_min/end_min: minutes from midnight.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min  INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min    INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK (end_min > start_min)
);

-- ---------------------------------------------------------------------------
-- Blackout windows. This is the "no bookings during this time" feature:
-- anything overlapping a blackout disappears from the public calendar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blackouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at   INTEGER NOT NULL,            -- unix seconds, UTC
  ends_at     INTEGER NOT NULL,            -- unix seconds, UTC
  reason      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_blackouts_range ON blackouts (starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- Booking requests.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id          TEXT PRIMARY KEY,            -- uuid v4
  reference   TEXT NOT NULL UNIQUE,        -- human-friendly, e.g. ICF-7K2M
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  sport       TEXT NOT NULL DEFAULT '',
  package_id  TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  starts_at   INTEGER NOT NULL,            -- unix seconds, UTC
  ends_at     INTEGER NOT NULL,            -- unix seconds, UTC
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  ip_hash     TEXT NOT NULL DEFAULT '',
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_bookings_range  ON bookings (starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings (created_at);

-- ---------------------------------------------------------------------------
-- Contact form messages. Kept separate from bookings: different lifecycle,
-- different retention, and a message is not a request for a slot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  body        TEXT NOT NULL,
  handled     INTEGER NOT NULL DEFAULT 0 CHECK (handled IN (0, 1)),
  created_at  INTEGER NOT NULL,
  ip_hash     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (handled, created_at);

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiting for public and owner endpoints.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,
  locked_until  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- Key/value settings. `booking_enabled` is the master on/off switch the owner
-- flips when they are not taking work at all.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES
  ('booking_enabled', '1', unixepoch()),
  ('booking_paused_message',
   'Bookings are closed while the current season wraps up. Send a note through the contact form and you will be first in line when the calendar reopens.',
   unixepoch());

-- Default studio hours: Thursday-Sunday, generous daylight windows.
INSERT OR IGNORE INTO availability_rules (id, weekday, start_min, end_min, active) VALUES
  (1, 4,  540, 1140, 1),   -- Thursday 09:00-19:00
  (2, 5,  540, 1140, 1),   -- Friday   09:00-19:00
  (3, 6,  480, 1200, 1),   -- Saturday 08:00-20:00
  (4, 0,  480, 1200, 1);   -- Sunday   08:00-20:00
