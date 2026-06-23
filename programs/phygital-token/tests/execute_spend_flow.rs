mod common;

use common::{assert_token_program_error, current_slot_entry, TestContext, TestPasskey};
use phygital_token::AssetType;
use solana_keypair::Keypair;
use solana_signer::Signer;

const USDC_DECIMALS: u8 = 6;

/// Happy path: a locked Lockable asset, an owner-approved budget of 100, two passkey-gated
/// spends that deplete it, and a third spend that fails once the budget is gone.
#[test]
fn execute_spend_depletes_reusable_budget() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Lockable);

    // Claim to a real owner; a Lockable asset auto-relocks after the transfer.
    let owner = Keypair::new();
    ctx.set_current_slot(500);
    ctx.send_execute_transfer(&asset, &owner, true)
        .expect("claim");
    assert_eq!(ctx.asset_fields(asset.asset).0, owner.pubkey());
    assert!(
        ctx.asset_lock_state(asset.asset),
        "Lockable asset should be locked after claim"
    );

    // USDC stand-in: fund the owner and approve the per-asset spend authority for 100.
    let (usdc, usdc_authority) = ctx.create_spendable_mint(USDC_DECIMALS);
    ctx.mint_spendable_to(usdc, &usdc_authority, owner.pubkey(), 1_000);
    let approve_ix = ctx.approve_spend_ix(owner.pubkey(), usdc, asset.asset, 100, USDC_DECIMALS);
    TestContext::send_instruction(&mut ctx.svm, approve_ix, &[&owner]).expect("approve");
    assert_eq!(
        ctx.token_delegate_info(owner.pubkey(), usdc),
        (Some(ctx.spend_authority_pda(asset.asset)), 100),
        "delegate set to per-asset spend authority with full budget"
    );

    let recipient = Keypair::new();

    // First spend: 30.
    ctx.set_current_slot(600);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        30,
        slot,
        hash,
    )
    .expect("spend 30");
    assert_eq!(ctx.token_balance(recipient.pubkey(), usdc), 30);
    assert_eq!(ctx.token_delegate_info(owner.pubkey(), usdc).1, 70);
    assert_eq!(ctx.last_transfer_slot(asset.asset), 600);

    // Second spend: 70 (depletes the budget).
    ctx.set_current_slot(700);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        70,
        slot,
        hash,
    )
    .expect("spend 70");
    assert_eq!(ctx.token_balance(recipient.pubkey(), usdc), 100);
    let (delegate, remaining) = ctx.token_delegate_info(owner.pubkey(), usdc);
    assert_eq!(remaining, 0);
    assert_eq!(
        delegate, None,
        "SPL clears the delegate once delegated_amount reaches zero"
    );

    // Third spend fails: the budget is gone and the delegate was cleared.
    ctx.set_current_slot(800);
    let (slot, hash) = current_slot_entry(&ctx.svm);
    let res = ctx.send_execute_spend(
        &asset,
        owner.pubkey(),
        usdc,
        recipient.pubkey(),
        1,
        slot,
        hash,
    );
    assert_token_program_error(res, "SpendDelegateMismatch");
}
