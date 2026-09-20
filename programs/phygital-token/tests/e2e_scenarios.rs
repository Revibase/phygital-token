mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_phygital_token_program_error, current_slot_entry, unique_identifier, TestContext,
    TestPasskey,
};
use phygital_token::constants::ADMIN;
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
    ctx.send_transfer_ownership(&phygital_token, &first_recipient, true)
        .expect("claim");
    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), 1);
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        first_recipient.pubkey()
    );

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);

    ctx.send_transfer_ownership_at_slot(
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
fn e2e_remove_ownership_then_reclaim() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let first_holder = Keypair::new();
    let second_holder = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_transfer_ownership(&phygital_token, &first_holder, true)
        .expect("initial claim");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        first_holder.pubkey()
    );

    ctx.send_remove_ownership(&phygital_token, &first_holder)
        .expect("holder relinquishes ownership");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        Pubkey::default()
    );

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);

    ctx.send_transfer_ownership(&phygital_token, &second_holder, true)
        .expect("re-claim after remove ownership");
    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), 2);
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        second_holder.pubkey()
    );
}

#[test]
fn e2e_remove_ownership_from_unowned_token_is_rejected() {
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

    let err = ctx.send_remove_ownership(&phygital_token, &fake_owner);
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

    let err = ctx.send_transfer_ownership(&phygital_token, &next_recipient, true);
    assert_phygital_token_program_error(err, "PermanentOwnershipImmutable");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        owner.pubkey()
    );

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();
    let err = ctx.send_remove_ownership(&phygital_token, &owner);
    assert_phygital_token_program_error(err, "PermanentOwnershipImmutable");
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
    let ix = ctx.initialize_ix(ADMIN, phygital_token, args);
    let result = TestContext::send_instruction_as(&mut ctx.svm, ix, ADMIN);
    assert_phygital_token_program_error(result, "PermanentOwnerRequired");
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
    let ix = ctx.initialize_ix(ADMIN, phygital_token.phygital_token, args);
    TestContext::send_instruction_as(&mut ctx.svm, ix, ADMIN)
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

    ctx.send_set_mint(phygital_token.phygital_token, mint)
        .expect("bind mint before first claim");
    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);

    ctx.send_transfer_ownership(&phygital_token, &recipient, true)
        .expect("claim after set_mint");

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
