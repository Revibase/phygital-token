mod common;

use anchor_lang::AccountDeserialize;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use common::{
    assert_token_program_error, current_slot_entry, TestContext, TestPasskey, TEST_ORIGIN,
    TEST_RP_ID,
};
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn create_domain_config_initializes_allowlist() {
    let ctx = TestContext::new();

    let (authority, rp_id, origins) = ctx.domain_config_fields(TEST_RP_ID);
    assert_eq!(authority, ctx.payer.pubkey());
    assert_eq!(rp_id, TEST_RP_ID);
    assert_eq!(origins, vec![TEST_ORIGIN.to_string()]);

    let rp_id_hash: [u8; 32] = Sha256::digest(TEST_RP_ID.as_bytes()).into();
    let account = ctx
        .svm
        .get_account(&ctx.domain_config_pda(TEST_RP_ID))
        .expect("domain config account");
    let config = phygital_nfts::state::DomainConfig::try_deserialize(&mut account.data.as_ref())
        .expect("deserialize domain config");
    assert_eq!(config.rp_id_hash, rp_id_hash);
}

#[test]
fn create_domain_config_rejects_duplicate() {
    let mut ctx = TestContext::new();
    let ix = ctx.create_domain_config_ix(
        ctx.payer.pubkey(),
        ctx.payer.pubkey(),
        TEST_RP_ID,
        vec![TEST_ORIGIN.to_string()],
    );
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]);
    let err_str = format!("{:?}", err.expect_err("duplicate create should fail"));
    assert!(
        err_str.contains("already in use"),
        "expected duplicate init failure, got: {err_str}"
    );
}

#[test]
fn update_domain_config_replaces_origins_without_resizing() {
    let mut ctx = TestContext::new();
    let replacement = "http://127.0.0.1:3000".to_string();

    let ix = ctx.update_domain_config_ix(ctx.payer.pubkey(), TEST_RP_ID, vec![replacement.clone()]);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]).expect("replace origins");

    let (authority, rp_id, origins) = ctx.domain_config_fields(TEST_RP_ID);
    assert_eq!(authority, ctx.payer.pubkey());
    assert_eq!(rp_id, TEST_RP_ID);
    assert_eq!(origins, vec![replacement]);
}

#[test]
fn update_domain_config_expands_allowlist_with_realloc() {
    let mut ctx = TestContext::new();
    let extra_origin = "https://app.example.com".to_string();

    let ix = ctx.update_domain_config_ix(
        ctx.payer.pubkey(),
        TEST_RP_ID,
        vec![TEST_ORIGIN.to_string(), extra_origin.clone()],
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]).expect("expand origins");

    let (authority, rp_id, origins) = ctx.domain_config_fields(TEST_RP_ID);
    assert_eq!(authority, ctx.payer.pubkey());
    assert_eq!(rp_id, TEST_RP_ID);
    assert_eq!(origins, vec![TEST_ORIGIN.to_string(), extra_origin]);
}

#[test]
fn create_domain_config_uses_separate_pda_per_rp_id() {
    let mut ctx = TestContext::new();
    let other_rp_id = "example.com";
    let other_origin = "https://example.com".to_string();

    let ix = ctx.create_domain_config_ix(
        ctx.payer.pubkey(),
        ctx.payer.pubkey(),
        other_rp_id,
        vec![other_origin.clone()],
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer])
        .expect("create other domain config");

    assert_ne!(
        ctx.domain_config_pda(TEST_RP_ID),
        ctx.domain_config_pda(other_rp_id)
    );
    let (authority, rp_id, origins) = ctx.domain_config_fields(other_rp_id);
    assert_eq!(authority, ctx.payer.pubkey());
    assert_eq!(rp_id, other_rp_id);
    assert_eq!(origins, vec![other_origin]);
}

#[test]
fn execute_transfer_rejects_unlisted_origin() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) = passkey.secp256r1_verify_instruction(
        TOKEN_2022_ID,
        asset.asset,
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );
    verify_args.origin = "https://evil.example.com".to_string();

    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        asset.asset,
        asset.mint,
        verify_args,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), common::LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "OriginMismatch");
}

#[test]
fn execute_transfer_rejects_wrong_domain_config_pda() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let other_rp_id = "other.example.com";
    let ix = ctx.create_domain_config_ix(
        ctx.payer.pubkey(),
        ctx.payer.pubkey(),
        other_rp_id,
        vec!["https://other.example.com".to_string()],
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer])
        .expect("create other domain config");

    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(
        TOKEN_2022_ID,
        asset.asset,
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );

    let wrong_domain_config = ctx.domain_config_pda(other_rp_id);
    let transfer_ix = ctx.execute_transfer_ix_with_domain_config(
        recipient.pubkey(),
        ctx.program_authority(),
        asset.asset,
        asset.mint,
        verify_args,
        wrong_domain_config,
    );

    ctx.svm
        .airdrop(&recipient.pubkey(), common::LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "DomainConfigMismatch");
}

#[test]
fn update_domain_config_rejects_non_authority() {
    let mut ctx = TestContext::new();
    let attacker = Keypair::new();
    ctx.svm
        .airdrop(&attacker.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let ix =
        ctx.update_domain_config_ix(attacker.pubkey(), TEST_RP_ID, vec![TEST_ORIGIN.to_string()]);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&attacker]);
    assert_token_program_error(err, "AuthorityMismatch");

    let (_, _, origins) = ctx.domain_config_fields(TEST_RP_ID);
    assert_eq!(origins, vec![TEST_ORIGIN.to_string()]);
}

#[test]
fn update_domain_config_transfers_authority() {
    let mut ctx = TestContext::new();
    let new_authority = Keypair::new();
    ctx.svm
        .airdrop(&new_authority.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let ix = ctx.update_domain_config_ix_with_args(
        ctx.payer.pubkey(),
        TEST_RP_ID,
        phygital_nfts::UpdateDomainConfigArgs {
            new_authority: Some(new_authority.pubkey()),
            new_origins: None,
        },
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]).expect("transfer authority");

    let (authority, rp_id, origins) = ctx.domain_config_fields(TEST_RP_ID);
    assert_eq!(authority, new_authority.pubkey());
    assert_eq!(rp_id, TEST_RP_ID);
    assert_eq!(origins, vec![TEST_ORIGIN.to_string()]);

    let old_authority_ix = ctx.update_domain_config_ix(
        ctx.payer.pubkey(),
        TEST_RP_ID,
        vec![TEST_ORIGIN.to_string()],
    );
    let err = TestContext::send_instruction(&mut ctx.svm, old_authority_ix, &[&ctx.payer]);
    assert_token_program_error(err, "AuthorityMismatch");

    let extra_origin = "https://extra.example.com".to_string();
    let new_authority_ix = ctx.update_domain_config_ix(
        new_authority.pubkey(),
        TEST_RP_ID,
        vec![TEST_ORIGIN.to_string(), extra_origin.clone()],
    );
    TestContext::send_instruction(&mut ctx.svm, new_authority_ix, &[&new_authority])
        .expect("new authority updates origins");

    let (_, _, origins) = ctx.domain_config_fields(TEST_RP_ID);
    assert_eq!(origins, vec![TEST_ORIGIN.to_string(), extra_origin]);
}

#[test]
fn create_domain_config_allows_designated_authority_to_mint() {
    let mut ctx = TestContext::new();
    let domain_authority = Keypair::new();
    let owner = Keypair::new();
    ctx.svm
        .airdrop(&domain_authority.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let rp_id = "mint.example.com";
    let origin = "https://mint.example.com".to_string();
    let create_ix = ctx.create_domain_config_ix(
        ctx.payer.pubkey(),
        domain_authority.pubkey(),
        rp_id,
        vec![origin],
    );
    TestContext::send_instruction(&mut ctx.svm, create_ix, &[&ctx.payer]).expect("create config");

    let group = common::create_external_group_mint(
        &mut ctx.svm,
        &ctx.payer,
        "Test Collection",
        "TCOL",
        "https://example.com/collection.json",
        100,
    );
    let mint = TestContext::create_design(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        common::sample_create_design_args(),
    );

    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = phygital_nfts::Secp256r1Pubkey(passkey.compressed_pubkey);
    let asset = ctx.asset_pda(&secp256r1_pubkey);
    let mint_ix = ctx.mint_token_ix_with_custody_ata(
        domain_authority.pubkey(),
        asset,
        mint,
        ctx.custody_ata(mint),
        ctx.domain_config_pda(rp_id),
        phygital_nfts::MintTokenArgs {
            secp256r1_pubkey,
            lock_asset_on_create: None,
        },
    );
    TestContext::send_instruction(&mut ctx.svm, mint_ix, &[&domain_authority])
        .expect("designated authority mints");

    assert_eq!(ctx.asset_domain_config(asset), ctx.domain_config_pda(rp_id));
    assert_eq!(ctx.token_balance(ctx.program_authority(), mint), 1);
}
