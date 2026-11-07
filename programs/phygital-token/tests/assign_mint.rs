mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AnchorSerialize, Discriminator};
use base64::Engine;
use common::{assert_phygital_token_program_error, unique_identifier, TestContext, TestPasskey};
use phygital_token::{InitializeArgs, InitializeEvent, PhygitalTokenType, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn initialize_leaves_mint_unset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);

    assert_eq!(
        ctx.phygital_token_mint(phygital_token.phygital_token),
        Pubkey::default()
    );
}

#[test]
fn initialize_sets_mint_and_emits_it() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let phygital_token = ctx.phygital_token_pda(&secp256r1_pubkey);
    let identifier = unique_identifier();
    let mint = Keypair::new().pubkey();
    let args = InitializeArgs {
        identifier,
        secp256r1_pubkey,
        token_type: PhygitalTokenType::Controlled,
        owner: Pubkey::default(),
        mint,
    };
    let ix = ctx.initialize_ix(ctx.issuer.pubkey(), phygital_token, args);
    let issuer = ctx.issuer.insecure_clone();
    let meta =
        TestContext::send_instruction(&mut ctx.svm, ix, &[&issuer]).expect("initialize with mint");

    assert_eq!(ctx.phygital_token_mint(phygital_token), mint);

    let event = InitializeEvent {
        authority: issuer.pubkey(),
        public_key: secp256r1_pubkey,
        identifier,
        owner: Pubkey::default(),
        token_type: PhygitalTokenType::Controlled,
        mint,
    };
    let mut bytes = InitializeEvent::DISCRIMINATOR.to_vec();
    event.serialize(&mut bytes).expect("serialize event");
    let expected = format!(
        "Program data: {}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    assert!(
        meta.logs.iter().any(|line| line == &expected),
        "InitializeEvent with the mint not in logs: {:#?}",
        meta.logs
    );
}

#[test]
fn assign_mint_minter_can_bind_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();

    ctx.send_assign_mint(phygital_token.phygital_token, mint)
        .expect("minter should be able to assign mint");

    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);
}

#[test]
fn assign_mint_minter_can_overwrite_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let first_mint = Keypair::new().pubkey();
    let second_mint = Keypair::new().pubkey();

    ctx.send_assign_mint(phygital_token.phygital_token, first_mint)
        .expect("first assign_mint");
    ctx.send_assign_mint(phygital_token.phygital_token, second_mint)
        .expect("overwrite assign_mint");

    assert_eq!(
        ctx.phygital_token_mint(phygital_token.phygital_token),
        second_mint
    );
}

#[test]
fn assign_mint_rejects_non_minter() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();
    let stranger = ctx.payer.insecure_clone();

    let ix = ctx.assign_mint_ix(stranger.pubkey(), phygital_token.phygital_token, mint);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&stranger]);
    assert_phygital_token_program_error(err, "UnauthorizedAuthority");
    assert_eq!(
        ctx.phygital_token_mint(phygital_token.phygital_token),
        Pubkey::default()
    );
}

#[test]
fn assign_mint_does_not_change_owner_or_last_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();
    let mint = Keypair::new().pubkey();

    ctx.send_set_owner(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    let owner_before = ctx.phygital_token_owner(phygital_token.phygital_token);
    let slot_before = ctx.last_slot(phygital_token.phygital_token);

    ctx.send_assign_mint(phygital_token.phygital_token, mint)
        .expect("assign mint after claim");

    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        owner_before
    );
    assert_eq!(ctx.last_slot(phygital_token.phygital_token), slot_before);
    assert_eq!(owner_before, holder.pubkey());
}
