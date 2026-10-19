-- A credential id alone doesn't identify a passkey: anyone can make a `none`
-- attestation naming someone else's credential id with their own key. Key each
-- backup by the credential id AND the public key it registered with, so a
-- squatter's row sits beside the owner's instead of blocking it; restore uses
-- the row whose key verifies the assertion.
CREATE TABLE revibase_signer_wallets_by_key (
  credential_id_hash TEXT NOT NULL,
  webauthn_public_key TEXT NOT NULL,   -- base64url COSE key from the registration attestation
  public_key TEXT NOT NULL,            -- the wallet's Solana address
  encrypted_blob TEXT NOT NULL,        -- base64url RSS1
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (credential_id_hash, webauthn_public_key)
);
INSERT INTO revibase_signer_wallets_by_key (credential_id_hash, webauthn_public_key, public_key, encrypted_blob, created_at, updated_at)
  SELECT credential_id_hash, webauthn_public_key, public_key, encrypted_blob, created_at, updated_at FROM revibase_signer_wallets;
DROP TABLE revibase_signer_wallets;
ALTER TABLE revibase_signer_wallets_by_key RENAME TO revibase_signer_wallets;
