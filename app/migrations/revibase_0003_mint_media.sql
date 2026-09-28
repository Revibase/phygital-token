-- Cached artwork for accessories with a bound mint (Helius DAS getAsset).
-- Misses are cached briefly too.
CREATE TABLE IF NOT EXISTS revibase_mint_media (
  mint TEXT PRIMARY KEY NOT NULL,
  image TEXT,
  name TEXT,
  fetched_at INTEGER NOT NULL
);
