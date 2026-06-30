mod common;

use anchor_lang::AccountDeserialize;
use common::{MintedAsset, TestContext, TestPasskey, LAMPORTS_PER_SOL};
use phygital_token::state::Asset;
use phygital_token::{AssetType, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn remove_ownership_returns_token_to_custody_and_resets_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let holder = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim asset");

    let program_authority = ctx.program_authority();
    assert_eq!(ctx.token_balance(holder.pubkey(), asset.mint), 1);
    assert_eq!(ctx.token_balance(program_authority, asset.mint), 0);

    let (owner_before, _, _) = ctx.asset_fields(asset.asset);
    assert_eq!(owner_before, holder.pubkey());

    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership");

    assert_eq!(ctx.token_balance(holder.pubkey(), asset.mint), 0);
    assert_eq!(ctx.token_balance(program_authority, asset.mint), 1);
    assert!(
        !ctx.sender_ata_exists(holder.pubkey(), asset.mint),
        "owner ata should close when balance was 1"
    );

    let (owner_after, mint_after, _) = ctx.asset_fields(asset.asset);
    assert_eq!(owner_after, program_authority);
    assert_eq!(mint_after, asset.mint);
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
}

#[test]
fn remove_ownership_rejects_non_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let holder = Keypair::new();
    let attacker = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim asset");
    ctx.svm
        .airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_ownership(&asset, &attacker);
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("OwnerMismatch")
            || err_str.contains("AccountNotInitialized")
            || err_str.contains("3012"),
        "unexpected error: {err_str}"
    );
    assert_eq!(ctx.token_balance(holder.pubkey(), asset.mint), 1);
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 0);
}

#[test]
fn remove_ownership_rejects_owner_not_matching_asset_record() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let holder = Keypair::new();
    let impostor = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim asset");
    ctx.svm
        .airdrop(&impostor.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let ix = ctx.remove_ownership_ix(impostor.pubkey(), asset.asset, asset.mint);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&impostor]);
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("OwnerMismatch")
            || err_str.contains("AccountNotInitialized")
            || err_str.contains("3012"),
        "unexpected error: {err_str}"
    );
}

#[test]
fn remove_ownership_keeps_owner_ata_when_balance_remains() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey_a);
    ctx.mint_second_asset_same_design(&asset, &passkey_b);

    let holder = Keypair::new();
    let asset_a = MintedAsset {
        passkey: passkey_a.clone(),
        ..asset
    };
    let asset_b = MintedAsset {
        passkey: passkey_b.clone(),
        design_owner: Keypair::new(),
        recipient: Keypair::new(),
        mint: asset.mint,
        asset: ctx.asset_pda(&Secp256r1Pubkey(passkey_b.compressed_pubkey)),
        group_mint: asset.group_mint,
    };

    ctx.send_execute_transfer(&asset_a, &holder, true)
        .expect("claim first asset");
    let (first_slot, _) = common::current_slot_entry(&ctx.svm);
    ctx.set_current_slot(first_slot.saturating_add(1));
    ctx.send_execute_transfer(&asset_b, &holder, true)
        .expect("claim second asset");
    assert_eq!(ctx.token_balance(holder.pubkey(), asset.mint), 2);

    ctx.send_remove_ownership(&asset_a, &holder)
        .expect("remove ownership for one asset");

    assert_eq!(ctx.token_balance(holder.pubkey(), asset.mint), 1);
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
    assert!(
        ctx.sender_ata_exists(holder.pubkey(), asset.mint),
        "owner ata should stay open when another token remains"
    );
}

#[test]
fn remove_ownership_closes_owner_ata_when_last_token_on_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let holder = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim asset");
    assert!(ctx.sender_ata_exists(holder.pubkey(), asset.mint));

    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership");

    assert!(
        !ctx.sender_ata_exists(holder.pubkey(), asset.mint),
        "owner ata should close when this was their only token for the mint"
    );
}

#[test]
fn remove_ownership_clears_lock_on_lockable_asset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Lockable);
    let holder = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), true);

    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership from locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
    assert_eq!(ctx.asset_fields(asset.asset).0, ctx.program_authority());
}

#[test]
fn remove_ownership_rejects_wrong_mint() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset_a = ctx.mint_asset_with_passkey(&passkey_a);
    let asset_b = ctx.mint_asset_with_passkey(&passkey_b);
    let holder = Keypair::new();

    ctx.send_execute_transfer(&asset_a, &holder, true)
        .expect("claim asset A");

    let ix = ctx.remove_ownership_ix(holder.pubkey(), asset_a.asset, asset_b.mint);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&holder]);
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("OwnerMismatch")
            || err_str.contains("ConstraintRaw")
            || err_str.contains("3012"),
        "unexpected error: {err_str}"
    );
    assert_eq!(ctx.token_balance(holder.pubkey(), asset_a.mint), 1);
}

#[test]
fn remove_ownership_preserves_last_transfer_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let holder = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim asset");
    let slot_before = ctx.last_transfer_slot(asset.asset);

    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership");

    assert_eq!(ctx.last_transfer_slot(asset.asset), slot_before);
}

#[test]
fn remove_ownership_emits_expected_asset_state() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let holder = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim asset");
    ctx.send_remove_ownership(&asset, &holder)
        .expect("remove ownership");

    let asset_account = ctx
        .svm
        .get_account(&asset.asset)
        .expect("asset instance account");
    let instance = Asset::try_deserialize(&mut asset_account.data.as_ref())
        .expect("deserialize asset instance");
    assert_eq!(instance.owner, ctx.program_authority());
    assert_eq!(instance.mint, asset.mint);
    assert_eq!(
        instance.public_key,
        Secp256r1Pubkey(passkey.compressed_pubkey)
    );
    assert_eq!(instance.is_locked, false);
}
