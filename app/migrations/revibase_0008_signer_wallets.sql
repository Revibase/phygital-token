-- Encrypted passkey-wallet backups (secure-signer). The worker stores RSS1
-- ciphertext only; it never sees a key. Keyed by sha256(credential id).
CREATE TABLE IF NOT EXISTS revibase_signer_wallets (
  credential_id_hash TEXT PRIMARY KEY NOT NULL,
  public_key TEXT NOT NULL,            -- the wallet's Solana address
  encrypted_blob TEXT NOT NULL,        -- base64url RSS1
  webauthn_public_key TEXT NOT NULL,   -- base64url COSE key from the registration attestation
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
