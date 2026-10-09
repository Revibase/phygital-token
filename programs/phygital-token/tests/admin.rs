mod common;

use common::{
    assert_phygital_token_program_error, assert_transaction_failed, unique_identifier, TestContext,
    TestPasskey,
};
use phygital_token::{InitializeArgs, PhygitalTokenType, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn issuer_can_initialize() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let phygital_token = ctx.phygital_token_pda(&secp256r1_pubkey);
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey,
        token_type: PhygitalTokenType::Bearer,
        owner: anchor_lang::prelude::Pubkey::default(),
    };
    let issuer = ctx.issuer.insecure_clone();
    let ix = ctx.initialize_ix(issuer.pubkey(), phygital_token, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&issuer]).expect("issuer initialize");
}

#[test]
fn admin_cannot_initialize() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let phygital_token = ctx.phygital_token_pda(&secp256r1_pubkey);
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey,
        token_type: PhygitalTokenType::Bearer,
        owner: anchor_lang::prelude::Pubkey::default(),
    };
    let admin = ctx.admin.insecure_clone();
    let ix = ctx.initialize_ix(admin.pubkey(), phygital_token, args);
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&admin]),
        "UnauthorizedAuthority",
    );
}

#[test]
fn minter_can_assign_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();

    ctx.send_assign_mint(phygital_token.phygital_token, mint)
        .expect("minter assign_mint");
    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);
}

#[test]
fn issuer_cannot_assign_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();
    let issuer = ctx.issuer.insecure_clone();

    let ix = ctx.assign_mint_ix(issuer.pubkey(), phygital_token.phygital_token, mint);
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&issuer]),
        "UnauthorizedAuthority",
    );
}

#[test]
fn issuer_cannot_manage_roles() {
    let mut ctx = TestContext::new();
    let other = Keypair::new().pubkey();
    let issuer = ctx.issuer.insecure_clone();

    let ix = ctx.set_issuer_ix(issuer.pubkey(), other);
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&issuer]),
        "UnauthorizedAdmin",
    );
}

#[test]
fn admin_can_rotate_issuer() {
    let mut ctx = TestContext::new();
    let new_issuer = Keypair::new();
    ctx.svm
        .airdrop(&new_issuer.pubkey(), common::LAMPORTS_PER_SOL)
        .expect("airdrop new issuer");

    ctx.send_set_issuer(new_issuer.pubkey())
        .expect("rotate issuer");

    // Old issuer can no longer initialize.
    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let phygital_token = ctx.phygital_token_pda(&secp256r1_pubkey);
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey,
        token_type: PhygitalTokenType::Bearer,
        owner: anchor_lang::prelude::Pubkey::default(),
    };
    let old_issuer = ctx.issuer.insecure_clone();
    let ix = ctx.initialize_ix(old_issuer.pubkey(), phygital_token, args);
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&old_issuer]),
        "UnauthorizedAuthority",
    );

    // New issuer can initialize.
    let passkey2 = TestPasskey::generate();
    let secp256r1_pubkey2 = Secp256r1Pubkey(passkey2.compressed_pubkey);
    let phygital_token2 = ctx.phygital_token_pda(&secp256r1_pubkey2);
    let args2 = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey: secp256r1_pubkey2,
        token_type: PhygitalTokenType::Bearer,
        owner: anchor_lang::prelude::Pubkey::default(),
    };
    let ix2 = ctx.initialize_ix(new_issuer.pubkey(), phygital_token2, args2);
    TestContext::send_instruction(&mut ctx.svm, ix2, &[&new_issuer]).expect("new issuer init");
}

#[test]
fn set_admin_transfers_sole_admin() {
    let mut ctx = TestContext::new();
    let new_admin = Keypair::new();
    ctx.svm
        .airdrop(&new_admin.pubkey(), common::LAMPORTS_PER_SOL)
        .expect("airdrop new admin");

    let admin = ctx.admin.insecure_clone();
    let ix = ctx.set_admin_ix(admin.pubkey(), new_admin.pubkey());
    TestContext::send_instruction(&mut ctx.svm, ix, &[&admin]).expect("set_admin");

    // Old admin can no longer set issuer.
    let other = Keypair::new().pubkey();
    assert_phygital_token_program_error(ctx.send_set_issuer(other), "UnauthorizedAdmin");

    // New admin can set issuer.
    let next_issuer = Keypair::new().pubkey();
    let ix = ctx.set_issuer_ix(new_admin.pubkey(), next_issuer);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&new_admin]).expect("new admin set_issuer");
}

#[test]
fn set_admin_rejects_existing_issuer() {
    let mut ctx = TestContext::new();
    let admin = ctx.admin.insecure_clone();
    let ix = ctx.set_admin_ix(admin.pubkey(), ctx.issuer.pubkey());
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&admin]),
        "KeyAlreadyExists",
    );
}

#[test]
fn set_admin_rejects_existing_minter() {
    let mut ctx = TestContext::new();
    let admin = ctx.admin.insecure_clone();
    let ix = ctx.set_admin_ix(admin.pubkey(), ctx.minter.pubkey());
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&admin]),
        "KeyAlreadyExists",
    );
}

#[test]
fn create_config_rejects_reinit() {
    let mut ctx = TestContext::new();
    let admin = ctx.admin.insecure_clone();
    let ix = ctx.create_config_ix(admin.pubkey());
    assert_transaction_failed(TestContext::send_instruction(&mut ctx.svm, ix, &[&admin]));
}

#[test]
fn non_issuer_cannot_initialize() {
    let mut ctx = TestContext::new();
    let stranger = ctx.payer.insecure_clone();
    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let phygital_token = ctx.phygital_token_pda(&secp256r1_pubkey);
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey,
        token_type: PhygitalTokenType::Bearer,
        owner: anchor_lang::prelude::Pubkey::default(),
    };
    let ix = ctx.initialize_ix(stranger.pubkey(), phygital_token, args);
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&stranger]),
        "UnauthorizedAuthority",
    );
}

#[test]
fn admin_can_close_phygital_token_and_reclaim_rent() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let minted = ctx.init_phygital_token(&passkey);
    let phygital_token = minted.phygital_token;

    let before = ctx
        .svm
        .get_account(&phygital_token)
        .expect("phygital_token exists before close");
    let rent_lamports = before.lamports;
    assert!(rent_lamports > 0);

    let recipient = Keypair::new();
    ctx.svm
        .airdrop(&recipient.pubkey(), common::LAMPORTS_PER_SOL)
        .expect("airdrop rent recipient");
    let recipient_before = ctx
        .svm
        .get_account(&recipient.pubkey())
        .expect("recipient funded")
        .lamports;

    ctx.send_close_phygital_token(recipient.pubkey(), phygital_token)
        .expect("admin close_phygital_token");

    assert!(
        ctx.svm.get_account(&phygital_token).is_none(),
        "phygital_token account should be closed"
    );
    let recipient_after = ctx
        .svm
        .get_account(&recipient.pubkey())
        .expect("recipient still funded")
        .lamports;
    assert_eq!(recipient_after, recipient_before + rent_lamports);

    // Same passkey can be re-initialized after close.
    let reinit = ctx.init_phygital_token(&passkey);
    assert_eq!(reinit.phygital_token, phygital_token);
}

#[test]
fn non_admin_cannot_close_phygital_token() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let minted = ctx.init_phygital_token(&passkey);
    let issuer = ctx.issuer.insecure_clone();

    let ix = ctx.close_phygital_token_ix(issuer.pubkey(), issuer.pubkey(), minted.phygital_token);
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&issuer]),
        "UnauthorizedAdmin",
    );
}
