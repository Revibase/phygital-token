-- Prepaid network fees (/api/sponsor). Each accessory starts with a fixed
-- prepaid amount (SPONSOR_PREPAID_LAMPORTS); every transaction a pool key pays
-- for is one row here, keyed by its signature (the fee payer's).
--
-- balance = prepaid
--         - cost  of pending and confirmed rows
--         - fee   of failed rows (landed with an error: the fee was paid, rent and refill rolled back)
--         + refill of confirmed rows (only once it has landed)
-- Dropped rows (blockhash expired, never landed) count for nothing.
CREATE TABLE IF NOT EXISTS revibase_sponsor_txs (
  signature TEXT PRIMARY KEY NOT NULL,
  phygital_token TEXT NOT NULL,
  fee_payer TEXT NOT NULL,
  fee_lamports INTEGER NOT NULL,       -- network fee
  cost_lamports INTEGER NOT NULL,      -- fee plus any tap-payments rent the pool key paid
  refill_lamports INTEGER NOT NULL,    -- accessory wallet -> fee payer, inside the transaction
  blockhash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed', 'dropped')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS revibase_sponsor_txs_token ON revibase_sponsor_txs (phygital_token, status);
