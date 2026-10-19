-- The passkey wallet (secure-signer backups) and the fee sponsor were removed.
DROP TABLE IF EXISTS revibase_signer_wallets;
DROP TABLE IF EXISTS revibase_sponsor_txs;
