mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_phygital_token_program_error, current_slot_entry, unique_identifier, TestContext,
    TestPasskey,
};
use phygital_token::{InitializeArgs, PhygitalTokenType, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn e2e_happy_lifecycle_with_retransfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_set_owner(&phygital_token, &first_recipient, true)
        .expect("claim");
    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), 1);
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        first_recipient.pubkey()
    );

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);

    ctx.send_set_owner_at_slot(
        &phygital_token,
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
        None,
    )
    .expect("re-transfer");

    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), 2);
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        second_recipient.pubkey()
    );
}

#[test]
fn e2e_remove_owner_then_reclaim() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let first_holder = Keypair::new();
    let second_holder = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_set_owner(&phygital_token, &first_holder, true)
        .expect("initial claim");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        first_holder.pubkey()
    );

    ctx.send_remove_owner(&phygital_token, &first_holder)
        .expect("holder relinquishes owner");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        Pubkey::default()
    );

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);

    ctx.send_set_owner(&phygital_token, &second_holder, true)
        .expect("re-claim after remove owner");
    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), 2);
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        second_holder.pubkey()
    );
}

#[test]
fn e2e_remove_owner_from_unowned_token_is_rejected() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);

    // Nobody has claimed the phygital_token, so owner is the default pubkey.
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        Pubkey::default()
    );

    let fake_owner = Keypair::new();
    ctx.svm
        .airdrop(&fake_owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_owner(&phygital_token, &fake_owner);
    assert_phygital_token_program_error(err, "OwnerMismatch");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        Pubkey::default()
    );
}

#[test]
fn e2e_permanent_owner_cannot_transfer_or_forfeit() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let owner = Keypair::new();
    let next_recipient = Keypair::new();
    let phygital_token =
        ctx.init_phygital_token_with_owner(&passkey, PhygitalTokenType::Permanent, owner.pubkey());

    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        owner.pubkey()
    );

    // Permanent tokens are initialized locked (owner set at init), so
    // set_owner fails on the lock check rather than a Permanent-specific error.
    let err = ctx.send_set_owner(&phygital_token, &next_recipient, true);
    assert_phygital_token_program_error(err, "TokenIsCurrentlyLocked");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        owner.pubkey()
    );
    assert!(ctx.phygital_token_lock_state(phygital_token.phygital_token));

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();
    let err = ctx.send_remove_owner(&phygital_token, &owner);
    assert_phygital_token_program_error(err, "PermanentOwnerImmutable");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        owner.pubkey()
    );
}

#[test]
fn e2e_permanent_initialize_requires_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let phygital_token = ctx.phygital_token_pda(&secp256r1_pubkey);
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey,
        token_type: PhygitalTokenType::Permanent,
        owner: Pubkey::default(),
    };
    let ix = ctx.initialize_ix(ctx.issuer.pubkey(), phygital_token, args);
    let issuer = ctx.issuer.insecure_clone();
    let result = TestContext::send_instruction(&mut ctx.svm, ix, &[&issuer]);
    assert_phygital_token_program_error(result, "PermanentOwnerRequired");
}

#[test]
fn e2e_non_permanent_initialize_rejects_owner() {
    for token_type in [PhygitalTokenType::Bearer, PhygitalTokenType::Controlled] {
        let mut ctx = TestContext::new();
        let passkey = TestPasskey::generate();
        let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
        let phygital_token = ctx.phygital_token_pda(&secp256r1_pubkey);
        let args = InitializeArgs {
            identifier: unique_identifier(),
            secp256r1_pubkey,
            token_type,
            owner: Keypair::new().pubkey(),
        };
        let ix = ctx.initialize_ix(ctx.issuer.pubkey(), phygital_token, args);
        let issuer = ctx.issuer.insecure_clone();
        let result = TestContext::send_instruction(&mut ctx.svm, ix, &[&issuer]);
        assert_phygital_token_program_error(result, "PermanentOwnerRequired");
    }
}

#[test]
fn e2e_token_pubkey_reinit_is_blocked() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);

    // Re-initializing the same passkey PDA must fail (account already exists).
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey: Secp256r1Pubkey(passkey.compressed_pubkey),
        token_type: PhygitalTokenType::Bearer,
        owner: Pubkey::default(),
    };
    let ix = ctx.initialize_ix(ctx.issuer.pubkey(), phygital_token.phygital_token, args);
    let issuer = ctx.issuer.insecure_clone();
    TestContext::send_instruction(&mut ctx.svm, ix, &[&issuer])
        .expect_err("re-initializing an existing phygital_token PDA should fail");
}

#[test]
fn e2e_initialize_rejects_non_authority() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let phygital_token = ctx.phygital_token_pda(&secp256r1_pubkey);
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey,
        token_type: PhygitalTokenType::Bearer,
        owner: Pubkey::default(),
    };
    let stranger = ctx.payer.insecure_clone();
    let ix = ctx.initialize_ix(stranger.pubkey(), phygital_token, args);
    let result = TestContext::send_instruction(&mut ctx.svm, ix, &[&stranger]);
    assert_phygital_token_program_error(result, "UnauthorizedAuthority");
}

#[test]
fn e2e_set_mint_then_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();
    let recipient = Keypair::new();

    assert_eq!(
        ctx.phygital_token_mint(phygital_token.phygital_token),
        Pubkey::default()
    );

    ctx.send_assign_mint(phygital_token.phygital_token, mint)
        .expect("bind mint before first claim");
    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);

    ctx.send_set_owner(&phygital_token, &recipient, true)
        .expect("claim after assign_mint");

    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        recipient.pubkey()
    );
    assert_eq!(
        ctx.phygital_token_mint(phygital_token.phygital_token),
        mint,
        "transfer must not clear the bound mint"
    );
}
