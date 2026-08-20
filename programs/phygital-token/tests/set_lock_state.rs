mod common;

use common::{assert_token_program_error, current_slot_entry, TestContext, TestPasskey};
use phygital_token::PhygitalTokenType;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn set_lock_state_owner_can_toggle_lock() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token_of_type(&passkey, PhygitalTokenType::Controlled);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("initial claim transfer");

    // Claiming a Controlled token auto-locks it.
    assert_eq!(ctx.token_lock_state(token.token), true);

    let unlock_ix = ctx.set_lock_state_ix(holder.pubkey(), token.token, false);
    TestContext::send_instruction(&mut ctx.svm, unlock_ix, &[&holder]).expect("unlock token");
    assert_eq!(ctx.token_lock_state(token.token), false);
}

#[test]
fn set_lock_state_rejects_non_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token_of_type(&passkey, PhygitalTokenType::Controlled);
    let holder = Keypair::new();
    let attacker = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("initial claim transfer");
    ctx.svm
        .airdrop(&attacker.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let ix = ctx.set_lock_state_ix(attacker.pubkey(), token.token, false);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&attacker]);
    assert_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.token_lock_state(token.token), true);
}

#[test]
fn set_lock_state_rejects_non_lockable_token() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("initial claim transfer");
    assert_eq!(ctx.token_lock_state(token.token), false);

    let ix = ctx.set_lock_state_ix(holder.pubkey(), token.token, true);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&holder]);
    assert_token_program_error(err, "TokenIsNotLockable");
    assert_eq!(ctx.token_lock_state(token.token), false);
}

#[test]
fn locked_holder_cannot_transfer() {
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

    let err = ctx
        .send_transfer_ownership(&token, &next_recipient, true)
        .expect_err("locked holder should not transfer");
    assert!(
        format!("{err:?}").contains("TokenIsCurrentlyLocked"),
        "unexpected error: {err:?}"
    );
    assert_eq!(ctx.token_owner(token.token), holder.pubkey());
}

#[test]
fn unlock_enables_holder_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token_of_type(&passkey, PhygitalTokenType::Controlled);
    let holder = Keypair::new();
    let next_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("claim locked token");

    let unlock_ix = ctx.set_lock_state_ix(holder.pubkey(), token.token, false);
    TestContext::send_instruction(&mut ctx.svm, unlock_ix, &[&holder]).expect("unlock token");

    ctx.set_current_slot(first_slot.saturating_add(1));

    ctx.send_transfer_ownership(&token, &next_recipient, true)
        .expect("unlocked holder can transfer");

    assert_eq!(ctx.token_owner(token.token), next_recipient.pubkey());
}
