-- Tables OWNED BY phygital-wallet in the shared `phygital-token` database,
-- mirrored here verbatim so local `wrangler dev` has them:
--   apps/api/d1/migrations/0006_tap_counters.sql
--   apps/api/d1/migrations/0007_auth_challenges.sql
-- IF NOT EXISTS makes this a no-op against the real shared database. If
-- phygital-wallet changes these schemas, update this mirror to match.
CREATE TABLE IF NOT EXISTS tap_counters (
  identifier TEXT PRIMARY KEY NOT NULL,
  c INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  namespace TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_challenges_expires_at ON auth_challenges (expires_at);
