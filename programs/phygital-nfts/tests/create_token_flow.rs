mod common;

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::{Account as SplAccount, Mint as SplMint};
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata;
use common::{
    create_external_group_mint, sample_create_design_args, sample_mint_token_args, TestContext,
    TestPasskey, SAMPLE_CARD_URI,
};
use phygital_nfts::state::CardInstance;
use phygital_nfts::{MintTokenArgs, Secp256r1Pubkey};
use phygital_nfts::utils::constants::MAX_METADATA_URI_LEN;
use solana_keypair::Keypair;
use solana_signer::Signer;
use spl_token_group_interface::state::TokenGroupMember;

#[test]
fn fund_program_authority_seeds_rent_pool() {
    let mut ctx = TestContext::new();
    let target = ctx.expected_rent_pool_target();

    assert!(ctx.svm.get_account(&ctx.program_authority()).is_none());

    ctx.fund_program_authority(None);

    let funded = ctx
        .svm
        .get_account(&ctx.program_authority())
        .expect("program authority account");
    assert_eq!(funded.lamports, target);
}

#[test]
fn create_mint_initializes_mint() {
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
    let group_mint = group.mint.pubkey();

    let mint_args = sample_create_design_args();
    let design_id = mint_args.design_id;
    let mint = TestContext::create_design(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        mint_args,
    );

    assert_eq!(mint, ctx.mint_pda(group_mint, design_id));

    let mint_account = ctx.svm.get_account(&mint).expect("design mint");
    let mint_state =
        StateWithExtensions::<SplMint>::unpack(&mint_account.data).expect("unpack mint");
    let member = mint_state
        .get_extension::<TokenGroupMember>()
        .expect("group member extension");
    assert_eq!(Pubkey::from(member.group), group_mint);

    let metadata = mint_state
        .get_variable_len_extension::<TokenMetadata>()
        .expect("token metadata");
    assert_eq!(metadata.name, "Test Design");
    assert_eq!(
        Option::<Pubkey>::from(metadata.update_authority),
        Some(owner.pubkey()),
        "design mint metadata update authority should be the owner"
    );
}

#[test]
fn create_mint_rejects_wrong_group_mint_authority() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let wrong_authority = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let group = create_external_group_mint(
        &mut ctx.svm,
        &ctx.payer,
        "Test Collection",
        "TCOL",
        "https://example.com/collection.json",
        100,
    );
    let args = sample_create_design_args();
    let mint = ctx.mint_pda(group.mint.pubkey(), args.design_id);

    let ix = ctx.create_mint_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        wrong_authority.pubkey(),
        mint,
        group.mint.pubkey(),
        args,
    );
    let err = TestContext::send_instruction(
        &mut ctx.svm,
        ix,
        &[&ctx.payer, &owner, &wrong_authority],
    )
    .expect_err("wrong group mint authority should fail");
    assert!(
        format!("{err:?}").contains("InvalidParentGroup") || format!("{err:?}").contains("6083"),
        "unexpected error: {err:?}"
    );
}

#[test]
fn mint_token_mints_card_into_design() {
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

    ctx.fund_program_authority(None);

    let mut token_args = sample_mint_token_args();
    token_args.mint = mint;
    let expected_uri = token_args.uri.clone();
    let card_instance = ctx.card_instance_pda(&token_args.secp256r1_pubkey);
    assert_eq!(
        card_instance,
        phygital_nfts::state::find_card_instance_pda(&token_args.secp256r1_pubkey, &ctx.program_id)
            .0
    );

    let token_ix = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        card_instance,
        mint,
        token_args,
    );
    TestContext::send_instruction(&mut ctx.svm, token_ix, &[&ctx.payer])
        .expect("mint token");

    let card_account = ctx
        .svm
        .get_account(&card_instance)
        .expect("card instance account");
    let instance = CardInstance::try_deserialize(&mut card_account.data.as_ref())
        .expect("deserialize card instance");
    assert_eq!(instance.uri, expected_uri);
    assert_eq!(instance.mint, mint);
    assert_eq!(instance.owner, ctx.program_authority());

    let ata = anchor_spl::associated_token::get_associated_token_address_with_program_id(
        &ctx.program_authority(),
        &mint,
        &TOKEN_2022_ID,
    );
    let ata_account = ctx.svm.get_account(&ata).expect("custody ata");
    let ata_state =
        StateWithExtensions::<SplAccount>::unpack(&ata_account.data).expect("unpack ata");
    assert_eq!(ata_state.base.amount, 1);
}

#[test]
fn create_mint_rejects_metadata_exceeding_max_lengths() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let group = create_external_group_mint(
        &mut ctx.svm,
        &ctx.payer,
        "Test Collection",
        "TCOL",
        "https://example.com/collection.json",
        100,
    );

    let mut args = sample_create_design_args();
    args.uri = "u".repeat(MAX_METADATA_URI_LEN + 1);
    let mint = ctx.mint_pda(group.mint.pubkey(), args.design_id);

    let ix = ctx.create_mint_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        group.authority.pubkey(),
        mint,
        group.mint.pubkey(),
        args,
    );
    let err = TestContext::send_instruction(
        &mut ctx.svm,
        ix,
        &[&ctx.payer, &owner, &group.authority],
    )
    .expect_err("long uri should fail");
    assert!(
        format!("{err:?}").contains("MaxLengthExceeded") || format!("{err:?}").contains("6082"),
        "unexpected error: {err:?}"
    );
}

#[test]
fn mint_token_funds_program_authority_when_custody_ata_exists() {
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

    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let card_a = ctx.card_instance_pda(&Secp256r1Pubkey(passkey_a.compressed_pubkey));
    let card_b = ctx.card_instance_pda(&Secp256r1Pubkey(passkey_b.compressed_pubkey));

    let first_ix = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        card_a,
        mint,
        MintTokenArgs {
            secp256r1_pubkey: Secp256r1Pubkey(passkey_a.compressed_pubkey),
            mint,
            uri: SAMPLE_CARD_URI.to_string(),
        },
    );
    TestContext::send_instruction(&mut ctx.svm, first_ix, &[&ctx.payer])
        .expect("first mint");

    let token_account_rent = ctx.recipient_ata_rent();
    let program_authority = ctx.program_authority();
    let balance_before = ctx
        .svm
        .get_account(&program_authority)
        .map(|account| account.lamports)
        .unwrap_or(0);

    let second_ix = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        card_b,
        mint,
        MintTokenArgs {
            secp256r1_pubkey: Secp256r1Pubkey(passkey_b.compressed_pubkey),
            mint,
            uri: SAMPLE_CARD_URI.to_string(),
        },
    );
    TestContext::send_instruction(&mut ctx.svm, second_ix, &[&ctx.payer])
        .expect("second mint");

    let balance_after = ctx
        .svm
        .get_account(&program_authority)
        .expect("program authority account")
        .lamports;
    assert_eq!(balance_after, balance_before + token_account_rent);
}

#[test]
fn mint_token_rejects_uri_exceeding_max_length() {
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

    let mut token_args = sample_mint_token_args();
    token_args.mint = mint;
    token_args.uri = "u".repeat(MAX_METADATA_URI_LEN + 1);
    let card_instance = ctx.card_instance_pda(&token_args.secp256r1_pubkey);

    let token_ix = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        card_instance,
        mint,
        token_args,
    );
    let err = TestContext::send_instruction(&mut ctx.svm, token_ix, &[&ctx.payer])
        .expect_err("long uri should fail");
    assert!(
        format!("{err:?}").contains("MaxLengthExceeded") || format!("{err:?}").contains("6082"),
        "unexpected error: {err:?}"
    );
}
