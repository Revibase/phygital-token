mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_token_program_error, TestContext, TestPasskey, LAMPORTS_PER_SOL};
use phygital_token::{PhygitalTokenType, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn remove_ownership_resets_owner_to_default() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim asset");
    assert_eq!(ctx.asset_owner(asset.asset), holder.pubkey());

    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership");

    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
}

#[test]
fn remove_ownership_rejects_non_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let holder = Keypair::new();
    let attacker = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim asset");
    ctx.svm
        .airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_ownership(&asset, &attacker);
    assert_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.asset_owner(asset.asset), holder.pubkey());
}

#[test]
fn remove_ownership_rejects_owner_not_matching_asset_record() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let holder = Keypair::new();
    let impostor = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim asset");
    ctx.svm
        .airdrop(&impostor.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let ix = ctx.remove_ownership_ix(impostor.pubkey(), asset.asset);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&impostor]);
    assert_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.asset_owner(asset.asset), holder.pubkey());
}

#[test]
fn remove_ownership_clears_lock_on_lockable_asset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset_of_type(&passkey, PhygitalTokenType::Controlled);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), true);

    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership from locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());
}

#[test]
fn remove_ownership_preserves_last_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim asset");
    let count_before = ctx.last_sign_count(asset.asset);

    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership");

    assert_eq!(ctx.last_sign_count(asset.asset), count_before);
}

#[test]
fn remove_ownership_emits_expected_asset_state() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim asset");
    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership");

    let instance = ctx.asset_account(asset.asset);
    assert_eq!(instance.owner, Pubkey::default());
    assert_eq!(
        instance.public_key,
        Secp256r1Pubkey(passkey.compressed_pubkey)
    );
    assert_eq!(instance.is_locked, false);
}
