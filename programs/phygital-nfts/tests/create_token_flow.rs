mod common;

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::{Account as SplAccount, Mint as SplMint};
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use common::{sample_create_group_args, sample_create_token_args, TestContext};
use phygital_nfts::utils::{encode_secp256r1_pubkey, GROUP_UNIQUE_ID_METADATA_KEY, SECP256R1_METADATA_KEY};
use phygital_nfts::Secp256r1Pubkey;
use solana_keypair::Keypair;
use solana_signer::Signer;
use spl_token_group_interface::state::{TokenGroup, TokenGroupMember};
use spl_token_metadata_interface::state::TokenMetadata;

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
fn create_group_token_initializes_collection_mint() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let group_args = sample_create_group_args();
    let group_mint = TestContext::create_collection(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        group_args,
    );

    let mint_account = ctx
        .svm
        .get_account(&group_mint)
        .expect("collection mint");
    assert_eq!(mint_account.owner, TOKEN_2022_ID);
    assert_eq!(
        group_mint,
        ctx.group_mint_pda(1),
        "collection mint should be the program PDA"
    );

    let mint_state =
        StateWithExtensions::<SplMint>::unpack(&mint_account.data).expect("unpack mint");
    let group = mint_state
        .get_extension::<TokenGroup>()
        .expect("token group extension");
    assert_eq!(u64::from(group.max_size), 100);
    assert!(mint_state.get_extension::<TokenGroupMember>().is_err());

    let metadata = mint_state
        .get_variable_len_extension::<TokenMetadata>()
        .expect("token metadata");
    assert_eq!(metadata.name, "Test Collection");
    assert_eq!(metadata.symbol, "TCOL");
    let unique_id = metadata
        .additional_metadata
        .iter()
        .find(|(key, _)| key == GROUP_UNIQUE_ID_METADATA_KEY)
        .map(|(_, value)| value.as_str())
        .expect("unique id metadata");
    assert_eq!(unique_id, "1");
}

#[test]
fn create_token_mints_nft_into_collection() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let token_mint = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();

    let group_mint = TestContext::create_collection(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        sample_create_group_args(),
    );

    ctx.fund_program_authority(None);

    let token_ix = ctx.create_token_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        token_mint.pubkey(),
        group_mint,
        sample_create_token_args(),
    );
    TestContext::send_instruction(&mut ctx.svm, token_ix, &[&ctx.payer, &owner, &token_mint])
        .expect("create token");

    let mint_account = ctx
        .svm
        .get_account(&token_mint.pubkey())
        .expect("token mint");
    let mint_state =
        StateWithExtensions::<SplMint>::unpack(&mint_account.data).expect("unpack mint");
    let member = mint_state
        .get_extension::<TokenGroupMember>()
        .expect("group member extension");
    assert_eq!(Pubkey::from(member.group), group_mint);

    let metadata = mint_state
        .get_variable_len_extension::<TokenMetadata>()
        .expect("token metadata");
    assert_eq!(metadata.name, "Test NFT");

    let expected_secp = encode_secp256r1_pubkey(&Secp256r1Pubkey([0x02; 33]));
    let secp = metadata
        .additional_metadata
        .iter()
        .find(|(key, _)| key == SECP256R1_METADATA_KEY)
        .map(|(_, value)| value.as_str())
        .expect("secp256r1 metadata");
    assert_eq!(secp, expected_secp);

    let ata = anchor_spl::associated_token::get_associated_token_address_with_program_id(
        &owner.pubkey(),
        &token_mint.pubkey(),
        &TOKEN_2022_ID,
    );
    let ata_account = ctx.svm.get_account(&ata).expect("owner ata");
    let ata_state =
        StateWithExtensions::<SplAccount>::unpack(&ata_account.data).expect("unpack ata");
    assert_eq!(ata_state.base.amount, 1);
}

#[test]
fn create_token_rejects_metadata_exceeding_max_lengths() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let token_mint = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();

    let group_mint = TestContext::create_collection(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        sample_create_group_args(),
    );

    ctx.fund_program_authority(None);

    let mut args = sample_create_token_args();
    args.uri = "https://example.com/".to_string() + &"x".repeat(64);

    let token_ix = ctx.create_token_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        token_mint.pubkey(),
        group_mint,
        args,
    );
    let err = TestContext::send_instruction(&mut ctx.svm, token_ix, &[&ctx.payer, &owner, &token_mint])
        .expect_err("long uri should fail");
    assert!(
        format!("{err:?}").contains("MaxLengthExceeded") || format!("{err:?}").contains("6082"),
        "unexpected error: {err:?}"
    );
}

#[test]
fn create_group_token_rejects_metadata_exceeding_max_lengths() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let mut args = sample_create_group_args();
    args.name = "n".repeat(33);

    let group_mint = ctx.group_mint_pda(args.unique_id);
    let ix = ctx.create_group_token_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        group_mint,
        args,
    );
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer, &owner])
        .expect_err("long name should fail");
    assert!(
        format!("{err:?}").contains("MaxLengthExceeded") || format!("{err:?}").contains("6082"),
        "unexpected error: {err:?}"
    );
}
