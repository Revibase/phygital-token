mod common;

use anchor_lang::prelude::Pubkey;
use common::{current_slot_entry, TestContext, TestPasskey};
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
    assert_eq!(instance.last_transfer_slot, u64::MAX);

    let (transfer_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("execute_transfer should succeed");

    assert_eq!(
        ctx.last_transfer_slot(asset.asset),
        transfer_slot,
        "asset should record the slot used for the transfer"
    );
    assert_eq!(ctx.asset_owner(asset.asset), recipient.pubkey());
}
