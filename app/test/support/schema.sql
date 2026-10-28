-- The D1 schema the app expects. Migrations are kept out of git; keep this in step with them.
CREATE TABLE tap_counters (
  identifier TEXT PRIMARY KEY NOT NULL,
  c INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  namespace TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX auth_challenges_expires_at ON auth_challenges (expires_at);

CREATE TABLE revibase_identifier_cache (
  identifier TEXT PRIMARY KEY NOT NULL,
  pda TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
