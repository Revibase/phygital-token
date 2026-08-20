mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_token_program_error, current_slot_entry, unique_identifier, TestContext, TestPasskey,
};
use phygital_token::constants::ADMIN;
use phygital_token::{PhygitalTokenType, InitializeArgs, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn e2e_happy_lifecycle_with_retransfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_transfer_ownership(&token, &first_recipient, true)
        .expect("claim");
    assert_eq!(ctx.last_sign_count(token.token), 1);
    assert_eq!(ctx.token_owner(token.token), first_recipient.pubkey());

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);

    ctx.send_transfer_ownership_at_slot(
        &token,
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
        None,
    )
    .expect("re-transfer");

    assert_eq!(ctx.last_sign_count(token.token), 2);
    assert_eq!(ctx.token_owner(token.token), second_recipient.pubkey());
}

#[test]
fn e2e_remove_ownership_then_reclaim() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let first_holder = Keypair::new();
    let second_holder = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_transfer_ownership(&token, &first_holder, true)
        .expect("initial claim");
    assert_eq!(ctx.token_owner(token.token), first_holder.pubkey());

    ctx.send_remove_ownership(&token, &first_holder)
        .expect("holder relinquishes ownership");
    assert_eq!(ctx.token_owner(token.token), Pubkey::default());

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);

    ctx.send_transfer_ownership(&token, &second_holder, true)
        .expect("re-claim after remove ownership");
    assert_eq!(ctx.last_sign_count(token.token), 2);
    assert_eq!(ctx.token_owner(token.token), second_holder.pubkey());
}

#[test]
fn e2e_remove_ownership_from_unowned_token_is_rejected() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    // Nobody has claimed the token, so owner is the default pubkey.
    assert_eq!(ctx.token_owner(token.token), Pubkey::default());

    let fake_owner = Keypair::new();
    ctx.svm
        .airdrop(&fake_owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_ownership(&token, &fake_owner);
    assert_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.token_owner(token.token), Pubkey::default());
}

#[test]
fn e2e_locked_holder_can_forfeit_via_remove_ownership() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token_of_type(&passkey, PhygitalTokenType::Controlled);
    let holder = Keypair::new();
    let next_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("claim locked token");
    assert_eq!(ctx.token_lock_state(token.token), true);

    ctx.set_current_slot(first_slot.saturating_add(1));

    let err = ctx.send_transfer_ownership(&token, &next_recipient, true);
    assert_token_program_error(err, "TokenIsCurrentlyLocked");

    ctx.send_remove_ownership(&token, &holder)
        .expect("forfeit locked token");
    assert_eq!(ctx.token_lock_state(token.token), false);
    assert_eq!(ctx.token_owner(token.token), Pubkey::default());

    ctx.set_current_slot(first_slot.saturating_add(2));
    ctx.send_transfer_ownership(&token, &next_recipient, true)
        .expect("new holder claims the forfeited token");
    assert_eq!(ctx.token_owner(token.token), next_recipient.pubkey());
}

#[test]
fn e2e_token_pubkey_reinit_is_blocked() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    // Re-initializing the same passkey PDA must fail (account already exists).
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey: Secp256r1Pubkey(passkey.compressed_pubkey),
        token_type: PhygitalTokenType::Bearer,
    };
    let ix = ctx.initialize_ix(ADMIN, token.token, args);
    TestContext::send_instruction_as(&mut ctx.svm, ix, ADMIN)
        .expect_err("re-initializing an existing token PDA should fail");
}

#[test]
fn e2e_initialize_rejects_non_authority() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let token = ctx.token_pda(&secp256r1_pubkey);
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey,
        token_type: PhygitalTokenType::Bearer,
    };
    let stranger = ctx.payer.insecure_clone();
    let ix = ctx.initialize_ix(stranger.pubkey(), token, args);
    let result = TestContext::send_instruction(&mut ctx.svm, ix, &[&stranger]);
    assert_token_program_error(result, "UnauthorizedAuthority");
}

#[test]
fn e2e_set_mint_then_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let mint = Keypair::new().pubkey();
    let recipient = Keypair::new();

    assert_eq!(ctx.token_mint(token.token), Pubkey::default());

    ctx.send_set_mint(token.token, mint)
        .expect("bind mint before first claim");
    assert_eq!(ctx.token_mint(token.token), mint);

    ctx.send_transfer_ownership(&token, &recipient, true)
        .expect("claim after set_mint");

    assert_eq!(ctx.token_owner(token.token), recipient.pubkey());
    assert_eq!(
        ctx.token_mint(token.token),
        mint,
        "transfer must not clear the bound mint"
    );
}
