mod common;

use anchor_lang::prelude::Pubkey;
use common::{TestContext, TestPasskey};
use phygital_token::Secp256r1Pubkey;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn e2e_initialize_and_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();

    // Freshly initialized asset is unowned and records both the unique chip
    // identifier (binding field) and the transfer-authorizing passkey public key
    // (which also seeds the PDA).
    let instance = ctx.asset_account(asset.asset);
    assert_eq!(instance.owner, Pubkey::default());
    assert_eq!(instance.identifier, asset.identifier);
    assert_eq!(
        instance.public_key,
        Secp256r1Pubkey(passkey.compressed_pubkey)
    );
    assert_ne!(
        instance.identifier, instance.public_key,
        "identifier must be distinct from the passkey public key"
    );
    assert_eq!(instance.last_sign_count, 0);

    ctx.send_transfer_ownership(&asset, &recipient, true)
        .expect("transfer_ownership should succeed");

    assert_eq!(
        ctx.last_sign_count(asset.asset),
        1,
        "asset should record the WebAuthn signCount used for the transfer"
    );
    assert_eq!(ctx.asset_owner(asset.asset), recipient.pubkey());
}
