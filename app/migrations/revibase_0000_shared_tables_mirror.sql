-- Tables shared with other services that accept the same tap URLs (see
-- README.md in this folder). Their schema is owned outside this app and is
-- mirrored here verbatim so local `wrangler dev` has them. IF NOT EXISTS makes
-- this a no-op against a shared production database. If the owning service
-- changes these schemas, update this mirror to match.
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
