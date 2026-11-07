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

-- Append-only audit log of the phygital-token program's events, from the Helius webhook.
-- The source the snapshot tables below are replayed from; triggers refuse UPDATE and DELETE.
CREATE TABLE program_events (
  signature TEXT NOT NULL,
  event_index INTEGER NOT NULL,          -- position among the program's events in the transaction
  slot INTEGER NOT NULL,
  index_within_block INTEGER,
  block_time INTEGER,                    -- ms
  event_name TEXT NOT NULL,              -- 'Unknown' for a discriminator this build doesn't know
  subject TEXT,                          -- token PDA or AdminConfig PDA
  data TEXT,                             -- decoded fields as JSON
  raw TEXT NOT NULL,                     -- logged bytes, base64
  received_at INTEGER NOT NULL,
  PRIMARY KEY (signature, event_index)
);

CREATE INDEX program_events_subject ON program_events (subject, slot, index_within_block);

CREATE TRIGGER program_events_no_update BEFORE UPDATE ON program_events
BEGIN SELECT RAISE(ABORT, 'program_events is append-only'); END;

CREATE TRIGGER program_events_no_delete BEFORE DELETE ON program_events
BEGIN SELECT RAISE(ABORT, 'program_events is append-only'); END;

-- Snapshot of each PhygitalToken account, replayed from program_events. Only the webhook writes it.
CREATE TABLE phygital_tokens (
  address TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,              -- base64url
  secp256r1_public_key TEXT NOT NULL,    -- base64url
  owner TEXT,                            -- NULL when unowned
  token_type TEXT NOT NULL,              -- 'Permanent' | 'Bearer' | 'Controlled'
  is_locked INTEGER NOT NULL,
  status TEXT NOT NULL,                  -- 'live' | 'closed'
  initialize_signature TEXT NOT NULL,
  created_at INTEGER NOT NULL,           -- block time of initialize, ms
  updated_at INTEGER NOT NULL,           -- block time of the last event, ms
  last_signature TEXT NOT NULL,
  last_slot INTEGER NOT NULL,
  event_count INTEGER NOT NULL,          -- events replayed; a write never lowers it
  synced_at INTEGER NOT NULL
);

CREATE INDEX phygital_tokens_identifier ON phygital_tokens (identifier);

-- Snapshot of the AdminConfig account, replayed from program_events. Only the webhook writes it.
CREATE TABLE admin_config (
  address TEXT PRIMARY KEY NOT NULL,
  admin TEXT,
  issuer TEXT,
  updated_at INTEGER NOT NULL,
  last_signature TEXT NOT NULL,
  last_slot INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  synced_at INTEGER NOT NULL
);

