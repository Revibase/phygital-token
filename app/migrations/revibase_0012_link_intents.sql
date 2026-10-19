-- Short-lived linking ceremonies (set_owner) for the in-app wallet and desktop
-- handoffs, restored after revibase_0010 dropped them. The columns are those of
-- 0001, 0004, 0006 and 0007 combined. Rows are pruned after expiry.
CREATE TABLE IF NOT EXISTS revibase_link_intents (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,                  -- 'phone' | 'desktop'
  state TEXT NOT NULL,
  acc_sid TEXT,                        -- accessory (tap) session that owns the ceremony
  finisher TEXT,                       -- 'acc' | 'hof' | 'dsk'
  finisher_sid TEXT,
  pda TEXT,
  identifier TEXT,
  public_key TEXT,                     -- base64url compressed passkey
  token_kind TEXT,                     -- 'permanent' | 'bearer' | 'controlled'
  capability_hash TEXT,                -- sha256(h | p), hex
  capability_expires_at INTEGER,
  capability_claimed_at INTEGER,
  capability_conflicts INTEGER NOT NULL DEFAULT 0,
  slot_number TEXT,
  slot_hash TEXT,                      -- base64
  slot_expires_at INTEGER,             -- epoch ms when the slot hash stops being usable
  challenge TEXT,                      -- base64url
  assertion TEXT,                      -- AuthenticationResponseJSON (deleted on terminal states)
  recipient TEXT,
  tx_signature TEXT,
  wallet_app TEXT,                     -- wallet app that finished the link (e.g. "Phantom")
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS revibase_link_intents_pda ON revibase_link_intents (pda);
CREATE UNIQUE INDEX IF NOT EXISTS revibase_link_intents_capability ON revibase_link_intents (capability_hash);
