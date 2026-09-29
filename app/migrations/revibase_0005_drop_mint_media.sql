-- Collectible metadata is read straight from DAS on demand; nothing is cached in D1.
-- Removes the table an earlier version created (a no-op on databases that never had it).
DROP TABLE IF EXISTS revibase_mint_media;
