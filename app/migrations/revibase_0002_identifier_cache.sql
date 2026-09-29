-- identifier (chip NDEF key) -> phygital token PDA. Both are immutable once a token
-- is initialized, so this avoids a getProgramAccounts scan on every tap.
CREATE TABLE IF NOT EXISTS revibase_identifier_cache (
  identifier TEXT PRIMARY KEY NOT NULL,
  pda TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
