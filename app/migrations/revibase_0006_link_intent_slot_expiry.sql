-- When the slot hash behind this ceremony's challenge stops being usable on-chain
-- (epoch ms, estimated once when the hash is fetched). Lets every status read know
-- whether the tap is still alive without touching the SlotHashes sysvar.
ALTER TABLE revibase_link_intents ADD COLUMN slot_expires_at INTEGER;
