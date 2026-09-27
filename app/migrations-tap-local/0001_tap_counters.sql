-- LOCAL DEVELOPMENT ONLY. Mirrors phygital-wallet/apps/api/d1/migrations/0006_tap_counters.sql
-- so `wrangler dev` has the shared table. Never apply this to the remote shared database;
-- phygital-wallet owns that schema.
CREATE TABLE IF NOT EXISTS tap_counters (
  identifier TEXT PRIMARY KEY NOT NULL,
  c INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
