mod common;

use anchor_lang::prelude::Pubkey;
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, spl_associated_token_account::instruction::create_associated_token_account_idempotent};
use common::{
    assert_token_program_error, current_slot_entry, MintedAsset, TestContext, TestPasskey,
};
use phygital_token::AssetType;
use solana_keypair::Keypair;
use solana_signer::Signer;
use spl_token_2022_interface::ID;

const USDC_DECIMALS: u8 = 6;

/// Mints a Lockable asset, claims it to a fresh owner (re-locking it), funds the owner with a
/// USDC stand-in, and approves the per-asset spend authority for `budget`.
/// Returns `(asset, owner, usdc_mint, usdc_mint_authority)`.
fn locked_owner_with_budget(
    ctx: &mut TestContext,
    passkey: &TestPasskey,
    budget: u64,
) -> (MintedAsset, Keypair, Pubkey, Keypair) {
    let asset = ctx.mint_asset_with_passkey_and_lock(passkey, AssetType::Lockable);
    let owner = Keypair::new();
    ctx.set_current_slot(500);
    ctx.send_execute_transfer(&asset, &owner, true)
        .expect("claim");

    let (usdc, usdc_authority) = ctx.create_spendable_mint(USDC_DECIMALS);
    ctx.mint_spendable_to(usdc, &usdc_authority, owner.pubkey(), 1_000);
    let approve_ix = ctx.approve_spend_ix(owner.pubkey(), usdc, asset.asset, budget, USDC_DECIMALS);
    TestContext::send_instruction(&mut ctx.svm, approve_ix, &[&owner]).expect("approve");

    (asset, owner, usdc, usdc_authority)
}

#[test]
fn spend_requires_locked_asset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let (asset, owner, usdc, _auth) = locked_owner_with_budget(&mut ctx, &passkey, 100);

    // Owner unlocks the asset; spending must now be rejected.
    let unlock = ctx.set_lock_state_ix(owner.pubkey(), asset.asset, false);
    TestContext::send_instruction(&mut ctx.svm, unlock, &[&owner]).expect("unlock");

    let recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    let res = ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    );
    assert_token_program_error(res, "AssetIsNotLocked");
}

#[test]
fn spend_without_approval_fails() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Lockable);
    let owner = Keypair::new();
    ctx.set_current_slot(500);
    ctx.send_execute_transfer(&asset, &owner, true)
        .expect("claim");

    // Owner funds a USDC ATA but never approves the spend authority.
    let (usdc, usdc_authority) = ctx.create_spendable_mint(USDC_DECIMALS);
    ctx.mint_spendable_to(usdc, &usdc_authority, owner.pubkey(), 1_000);

    let recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    let res = ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    );
    assert_token_program_error(res, "SpendDelegateMismatch");
}

#[test]
fn spend_with_wrong_passkey_fails() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let (asset, owner, usdc, _auth) = locked_owner_with_budget(&mut ctx, &passkey, 100);

    let attacker = TestPasskey::generate();
    let recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    // The recipient ATA must exist so account validation reaches the asset's secp256r1-PDA
    // constraint, which then rejects the wrong passkey.
    let ata_ix = ctx.create_recipient_ata_ix(ctx.payer.pubkey(), recipient.pubkey(), usdc);
    let (secp_ix, verify_args) =
        attacker.spend_secp256r1_instruction(recipient.pubkey(), usdc, 10, slot, hash);
    let spend_ix = ctx.execute_spend_ix(
        asset.asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        verify_args,
        10,
    );
    let res =
        TestContext::send_instructions(&mut ctx.svm, &[ata_ix, secp_ix, spend_ix], &[&ctx.payer]);
    assert_token_program_error(res, "Secp256r1PubkeyMismatch");
}

#[test]
fn spend_signature_cannot_be_redirected_to_another_recipient() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let (asset, owner, usdc, _auth) = locked_owner_with_budget(&mut ctx, &passkey, 100);

    let signed_recipient = Keypair::new();
    let attacker_recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    // Sign for `signed_recipient`, but submit `attacker_recipient` in the instruction.
    let (secp_ix, verify_args) =
        asset
            .passkey
            .spend_secp256r1_instruction(signed_recipient.pubkey(), usdc, 10, slot, hash);
    // The submitted recipient's ATA must exist now that the instruction no longer creates it.
    let ata_ix = ctx.create_recipient_ata_ix(ctx.payer.pubkey(), attacker_recipient.pubkey(), usdc);
    let spend_ix = ctx.execute_spend_ix(
        asset.asset,
        owner.pubkey(),
        usdc,
        attacker_recipient.pubkey(),
        verify_args,
        10,
    );
    let res =
        TestContext::send_instructions(&mut ctx.svm, &[ata_ix, secp_ix, spend_ix], &[&ctx.payer]);
    assert_token_program_error(res, "ChallengeHashMismatch");
}

#[test]
fn spend_signature_cannot_have_amount_inflated() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let (asset, owner, usdc, _auth) = locked_owner_with_budget(&mut ctx, &passkey, 100);

    let recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    // Sign for amount 10, but submit amount 50.
    let (secp_ix, verify_args) =
        asset
            .passkey
            .spend_secp256r1_instruction(recipient.pubkey(), usdc, 10, slot, hash);
    // The submitted recipient's ATA must exist now that the instruction no longer creates it.
    let ata_ix = ctx.create_recipient_ata_ix(ctx.payer.pubkey(), recipient.pubkey(), usdc);
    let spend_ix = ctx.execute_spend_ix(
        asset.asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        verify_args,
        50,
    );
    let res =
        TestContext::send_instructions(&mut ctx.svm, &[ata_ix, secp_ix, spend_ix], &[&ctx.payer]);
    assert_token_program_error(res, "ChallengeHashMismatch");
}

#[test]
fn spend_cannot_be_replayed_in_same_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let (asset, owner, usdc, _auth) = locked_owner_with_budget(&mut ctx, &passkey, 100);

    let recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    )
    .expect("first spend");

    // Replaying at the same slot (now == last_transfer_slot) must fail.
    let res = ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    );
    assert_token_program_error(res, "StaleSpendSlot");
}

#[test]
fn revoke_then_spend_fails() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let (asset, owner, usdc, _auth) = locked_owner_with_budget(&mut ctx, &passkey, 100);

    let revoke_ix = ctx.revoke_spend_ix(owner.pubkey(), usdc);
    TestContext::send_instruction(&mut ctx.svm, revoke_ix, &[&owner]).expect("revoke");

    let recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    let res = ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    );
    assert_token_program_error(res, "SpendDelegateMismatch");
}

/// Q1: after the asset changes owner, the old owner's approval is orphaned and unreachable.
#[test]
fn ownership_change_orphans_old_approval() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let (asset, old_owner, usdc, usdc_authority) =
        locked_owner_with_budget(&mut ctx, &passkey, 100);

    // Old owner unlocks, then transfers the asset to a new owner (re-locks under new owner).
    let unlock = ctx.set_lock_state_ix(old_owner.pubkey(), asset.asset, false);
    TestContext::send_instruction(&mut ctx.svm, unlock, &[&old_owner]).expect("unlock");

    let new_owner = Keypair::new();
    ctx.set_current_slot(550);
    ctx.send_execute_transfer_from(&asset, old_owner.pubkey(), &new_owner, true, None, None)
        .expect("transfer to new owner");
    assert_eq!(ctx.asset_fields(asset.asset).0, new_owner.pubkey());
    assert!(ctx.asset_lock_state(asset.asset));

    // The new owner has funds but never approved → spend fails.
    ctx.mint_spendable_to(usdc, &usdc_authority, new_owner.pubkey(), 1_000);
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    let recipient = Keypair::new();
    let res = ctx.send_execute_spend(
        &asset,
        new_owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    );
    assert_token_program_error(res, "SpendDelegateMismatch");

    // Pointing at the old owner's (still-approved) account fails the owner binding.
    let res_old = ctx.send_execute_spend(
        &asset,
        old_owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    );
    assert_token_program_error(res_old, "OwnerMismatch");
}

/// Q6: a budget approved for one asset cannot be drawn by a different asset of the same owner.
#[test]
fn spend_authority_is_scoped_per_asset() {
    let mut ctx = TestContext::new();
    let passkey1 = TestPasskey::generate();
    let passkey2 = TestPasskey::generate();

    let asset1 = ctx.mint_asset_with_passkey_and_lock(&passkey1, AssetType::Lockable);
    let asset2 = ctx.mint_asset_with_passkey_and_lock(&passkey2, AssetType::Lockable);

    // Claim both assets to the same owner (each re-locks).
    let owner = Keypair::new();
    ctx.set_current_slot(500);
    ctx.send_execute_transfer(&asset1, &owner, true)
        .expect("claim asset1");
    ctx.send_execute_transfer(&asset2, &owner, true)
        .expect("claim asset2");

    // Fund the owner once and approve only asset1's spend authority.
    let (usdc, usdc_authority) = ctx.create_spendable_mint(USDC_DECIMALS);
    ctx.mint_spendable_to(usdc, &usdc_authority, owner.pubkey(), 1_000);
    let approve_ix = ctx.approve_spend_ix(owner.pubkey(), usdc, asset1.asset, 100, USDC_DECIMALS);
    TestContext::send_instruction(&mut ctx.svm, approve_ix, &[&owner]).expect("approve asset1");

    let recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);

    // Tapping asset2 cannot draw the budget approved for asset1.
    let res = ctx.send_execute_spend(
        &asset2,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    );
    assert_token_program_error(res, "SpendDelegateMismatch");

    // Tapping asset1 works.
    ctx.send_execute_spend(
        &asset1,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    )
    .expect("asset1 spend");
    assert_eq!(ctx.token_balance(recipient.pubkey(), usdc), 10);
}

/// A spend advances the asset's shared `last_transfer_slot`, staling earlier-slot verify/transfer.
#[test]
fn spend_advances_shared_nonce() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let (asset, owner, usdc, _auth) = locked_owner_with_budget(&mut ctx, &passkey, 100);

    let recipient = Keypair::new();
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        10,
        slot,
        hash,
    )
    .expect("spend");
    assert_eq!(ctx.last_transfer_slot(asset.asset), 600);

    // A verify_asset signed for the same (now stale) slot is rejected by the shared guard.
    let res = ctx.send_verify_asset(&asset, "hello", true, Some(600), Some(hash));
    assert_token_program_error(res, "StaleTransferSlot");
}
