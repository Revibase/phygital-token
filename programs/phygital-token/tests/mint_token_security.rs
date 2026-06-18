mod common;

use common::{
    assert_token_program_error, create_external_group_mint, sample_create_mint_args,
    sample_mint_token_args, unauthorized_payer, TestContext, TestPasskey,
};
use phygital_token::constants::ADMIN;
use phygital_token::{MintTokenArgs, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn mint_token_records_domain_config_on_asset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey);

    assert_eq!(
        ctx.asset_domain_config(asset.asset),
        ctx.domain_config_pda(common::TEST_RP_ID)
    );
}

#[test]
fn mint_token_rejects_wrong_custody_ata() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    ctx.svm
        .airdrop(&owner.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();

    let group = create_external_group_mint(
        &mut ctx.svm,
        &ctx.payer,
        "Test Collection",
        "TCOL",
        "https://example.com/collection.json",
        100,
    );
    let mint = TestContext::create_mint(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        sample_create_mint_args(),
    );

    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let asset = ctx.asset_pda(&secp256r1_pubkey);
    let wrong_ata = Keypair::new().pubkey();
    let args = MintTokenArgs {
        secp256r1_pubkey,
        lock_asset_on_create: None,
    };

    let ix = ctx.mint_token_ix_with_custody_ata(
        ctx.payer.pubkey(),
        asset,
        mint,
        wrong_ata,
        ctx.domain_config_pda(common::TEST_RP_ID),
        args,
    );
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]);
    assert_token_program_error(err, "InvalidCustodyTokenAccount");
}

#[test]
fn mint_token_first_mint_succeeds_without_funding_program_authority() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey);

    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
    assert_eq!(ctx.program_authority_lamports(), 0);
}

#[test]
fn mint_token_subsequent_mint_tops_up_program_authority_rent() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey_a);
    let rent = ctx.token_account_rent();
    let balance_after_first = ctx.program_authority_lamports();

    ctx.mint_second_asset_same_design(&asset, &passkey_b);
    assert_eq!(ctx.program_authority_lamports(), balance_after_first + rent);

    let passkey_c = TestPasskey::generate();
    ctx.mint_second_asset_same_design(&asset, &passkey_c);
    assert_eq!(
        ctx.program_authority_lamports(),
        balance_after_first + rent * 2
    );
}

#[test]
fn mint_token_rejects_duplicate_secp256r1_pubkey() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey);

    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let args = MintTokenArgs {
        secp256r1_pubkey,
        lock_asset_on_create: None,
    };
    let ix = ctx.mint_token_ix(ctx.payer.pubkey(), asset.asset, asset.mint, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer])
        .expect_err("duplicate asset init should fail");
}

#[test]
fn mint_token_rejects_non_domain_authority() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let attacker = unauthorized_payer();
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();
    ctx.svm
        .airdrop(&attacker.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();

    let group = create_external_group_mint(
        &mut ctx.svm,
        &ctx.payer,
        "Test Collection",
        "TCOL",
        "https://example.com/collection.json",
        100,
    );
    let mint = TestContext::create_mint(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        sample_create_mint_args(),
    );

    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let asset = ctx.asset_pda(&secp256r1_pubkey);
    let args = MintTokenArgs {
        secp256r1_pubkey,
        lock_asset_on_create: None,
    };
    let ix = ctx.mint_token_ix(attacker.pubkey(), asset, mint, args);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&attacker]);
    assert_token_program_error(err, "AuthorityMismatch");
    assert_eq!(ctx.token_balance(ctx.program_authority(), mint), 0);
}

#[test]
fn mint_token_documents_secp256r1_pda_squatting_risk() {
    let mut ctx = TestContext::new();
    let victim_passkey = TestPasskey::generate();
    let attacker_passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&attacker_passkey);

    let victim_pubkey = Secp256r1Pubkey(victim_passkey.compressed_pubkey);
    let victim_asset = ctx.asset_pda(&victim_pubkey);
    let args = MintTokenArgs {
        secp256r1_pubkey: victim_pubkey,
        lock_asset_on_create: None,
    };
    let ix = ctx.mint_token_ix(ctx.payer.pubkey(), victim_asset, asset.mint, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]).expect("squatter mints first");

    let ix2 = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        victim_asset,
        asset.mint,
        MintTokenArgs {
            secp256r1_pubkey: victim_pubkey,
            lock_asset_on_create: None,
        },
    );
    TestContext::send_instruction(&mut ctx.svm, ix2, &[&ctx.payer])
        .expect_err("victim cannot re-init squatted PDA");
}

#[test]
#[ignore = "enable when mint_token payer is gated to ADMIN on mainnet"]
fn mint_token_rejects_non_admin_payer() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let non_admin = unauthorized_payer();
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();
    ctx.svm
        .airdrop(&non_admin.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();

    let group = create_external_group_mint(
        &mut ctx.svm,
        &ctx.payer,
        "Test Collection",
        "TCOL",
        "https://example.com/collection.json",
        100,
    );
    let mint = TestContext::create_mint(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        sample_create_mint_args(),
    );

    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let asset = ctx.asset_pda(&secp256r1_pubkey);
    let token_args = sample_mint_token_args();
    let ix = ctx.mint_token_ix(non_admin.pubkey(), asset, mint, token_args);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&non_admin]);
    assert_token_program_error(err, "AuthorityMismatch");
    let _ = ADMIN;
}
