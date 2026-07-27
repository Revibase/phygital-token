mod common;

use common::{
    assert_token_program_error, assert_transaction_failed, create_external_group_mint,
    create_plain_token2022_mint, sample_create_mint_args, sample_mint_token_args,
    unauthorized_payer, TestContext, TestPasskey,
};
use phygital_token::{AssetType, MintTokenArgs, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

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
        asset_type: AssetType::Transferable,
    };

    let ix = ctx.mint_token_ix_with_custody_ata(ctx.payer.pubkey(), asset, mint, wrong_ata, args);
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
        asset_type: AssetType::Transferable,
    };
    let ix = ctx.mint_token_ix(ctx.payer.pubkey(), asset.asset, asset.mint, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer])
        .expect_err("duplicate asset init should fail");
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
        asset_type: AssetType::Transferable,
    };
    let ix = ctx.mint_token_ix(ctx.payer.pubkey(), victim_asset, asset.mint, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]).expect("squatter mints first");

    let ix2 = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        victim_asset,
        asset.mint,
        MintTokenArgs {
            secp256r1_pubkey: victim_pubkey,
            asset_type: AssetType::Transferable,
        },
    );
    TestContext::send_instruction(&mut ctx.svm, ix2, &[&ctx.payer])
        .expect_err("victim cannot re-init squatted PDA");
}

#[test]
fn mint_token_rejects_mint_without_program_shape() {
    // A plain Token-2022 mint lacks the permanent-delegate / transfer-hook / pointer
    // extensions that the phygital design-mint shape requires, so `mint_token`'s shape check rejects it.
    let mut ctx = TestContext::new();
    let foreign_mint = create_plain_token2022_mint(&mut ctx.svm, &ctx.payer);

    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let asset = ctx.asset_pda(&secp256r1_pubkey);
    let args = MintTokenArgs {
        secp256r1_pubkey,
        asset_type: AssetType::Transferable,
    };

    let ix = ctx.mint_token_ix(ctx.payer.pubkey(), asset, foreign_mint.pubkey(), args);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]);
    assert_transaction_failed(err);
}

#[test]
fn mint_token_rejects_non_mint_authority() {
    // Minting is permissionless w.r.t. the program, but token-2022 still requires
    // the mint's `mint_authority` to authorize `mint_to`. A signer that isn't the
    // mint authority (here the harness sets it to `ctx.payer`) must be rejected.
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let non_authority = unauthorized_payer();
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();
    ctx.svm
        .airdrop(&non_authority.pubkey(), 2 * common::LAMPORTS_PER_SOL)
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

    let token_args = sample_mint_token_args();
    let asset = ctx.asset_pda(&token_args.secp256r1_pubkey);
    let ix = ctx.mint_token_ix(non_authority.pubkey(), asset, mint, token_args);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&non_authority]);
    assert_transaction_failed(err);
}
