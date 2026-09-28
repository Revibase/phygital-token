-- The accessory's token type ('permanent' | 'bearer' | 'controlled'), captured when the
-- accessory joins a ceremony, so every screen can word the link for that type without
-- an RPC per status poll. Immutable on-chain. NULL on rows created before this column.
ALTER TABLE revibase_link_intents ADD COLUMN token_kind TEXT;
