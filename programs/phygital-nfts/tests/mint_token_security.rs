mod common;

use common::{
    assert_token_program_error, create_external_group_mint, sample_create_design_args,
    sample_mint_token_args, unauthorized_payer, TestContext, TestPasskey,
};
use phygital_nfts::{MintTokenArgs, Secp256r1Pubkey};
use phygital_nfts::constants::ADMIN;
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
    let mint = TestContext::create_design(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        sample_create_design_args(),
    );

    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let card_instance = ctx.card_instance_pda(&secp256r1_pubkey);
    let wrong_ata = Keypair::new().pubkey();
    let args = MintTokenArgs { secp256r1_pubkey };

    let ix = ctx.mint_token_ix_with_custody_ata(
        ctx.payer.pubkey(),
        card_instance,
        mint,
        wrong_ata,
        args,
    );
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]);
    assert_token_program_error(err, "InvalidCustodyTokenAccount");
}

#[test]
fn mint_token_first_mint_succeeds_without_funding_program_authority() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&passkey);

    assert_eq!(ctx.token_balance(ctx.program_authority(), card.mint), 1);
    assert_eq!(ctx.program_authority_lamports(), 0);
}

#[test]
fn mint_token_subsequent_mint_tops_up_program_authority_rent() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&passkey_a);
    let rent = ctx.token_account_rent();
    let balance_after_first = ctx.program_authority_lamports();

    ctx.mint_second_card_same_design(&card, &passkey_b);
    assert_eq!(ctx.program_authority_lamports(), balance_after_first + rent);

    let passkey_c = TestPasskey::generate();
    ctx.mint_second_card_same_design(&card, &passkey_c);
    assert_eq!(ctx.program_authority_lamports(), balance_after_first + rent * 2);
}

#[test]
fn mint_token_rejects_duplicate_secp256r1_pubkey() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&passkey);

    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let args = MintTokenArgs { secp256r1_pubkey };
    let ix = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        card.card_instance,
        card.mint,
        args,
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer])
        .expect_err("duplicate card_instance init should fail");
}

#[test]
fn mint_token_allows_permissionless_inflation_on_existing_design() {
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
    let mint = TestContext::create_design(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        sample_create_design_args(),
    );

    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let card_instance = ctx.card_instance_pda(&secp256r1_pubkey);
    let args = MintTokenArgs { secp256r1_pubkey };
    let ix = ctx.mint_token_ix(attacker.pubkey(), card_instance, mint, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&attacker]).expect("attacker mint succeeds");
    assert_eq!(ctx.token_balance(ctx.program_authority(), mint), 1);
}

#[test]
fn mint_token_documents_secp256r1_pda_squatting_risk() {
    let mut ctx = TestContext::new();
    let victim_passkey = TestPasskey::generate();
    let attacker_passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&attacker_passkey);

    let victim_pubkey = Secp256r1Pubkey(victim_passkey.compressed_pubkey);
    let victim_card = ctx.card_instance_pda(&victim_pubkey);
    let args = MintTokenArgs {
        secp256r1_pubkey: victim_pubkey,
    };
    let ix = ctx.mint_token_ix(ctx.payer.pubkey(), victim_card, card.mint, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]).expect("squatter mints first");

    let ix2 = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        victim_card,
        card.mint,
        MintTokenArgs {
            secp256r1_pubkey: victim_pubkey,
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
    let mint = TestContext::create_design(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        sample_create_design_args(),
    );

    let passkey = TestPasskey::generate();
    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let card_instance = ctx.card_instance_pda(&secp256r1_pubkey);
    let token_args = sample_mint_token_args();
    let ix = ctx.mint_token_ix(non_admin.pubkey(), card_instance, mint, token_args);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&non_admin]);
    assert_token_program_error(err, "AuthorityMismatch");
    let _ = ADMIN;
}
