mod common;

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::{Account as SplAccount, Mint as SplMint};
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use common::{
    sample_create_domain_config_args, sample_create_group_args, sample_create_token_args,
    TestContext,
};
use phygital_nfts::utils::{
    encode_optional_pubkey, encode_secp256r1_pubkey, ALLOWED_RECIPIENT_METADATA_KEY,
    PAYMENT_TOKEN_MINT_METADATA_KEY, PAYMENT_TOKEN_PROGRAM_METADATA_KEY,
    ROYALTY_BPS_METADATA_KEY, SECP256R1_METADATA_KEY,
    TRANSFER_PRICE_METADATA_KEY,
};
use phygital_nfts::{Secp256r1Pubkey, SetTransferConfigArgs};
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
    let group_mint = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    TestContext::create_collection(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group_mint,
        sample_create_group_args(),
        sample_create_domain_config_args(),
    );

    let mint_account = ctx
        .svm
        .get_account(&group_mint.pubkey())
        .expect("collection mint");
    assert_eq!(mint_account.owner, TOKEN_2022_ID);

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
    let royalty = metadata
        .additional_metadata
        .iter()
        .find(|(key, _)| key == ROYALTY_BPS_METADATA_KEY)
        .map(|(_, value)| value.as_str())
        .expect("royalty bps metadata");
    assert_eq!(royalty, "500");
}

#[test]
fn create_group_token_rejects_invalid_royalty_bps() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let group_mint = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let domain_ix = ctx.create_domain_config_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        sample_create_domain_config_args(),
    );
    TestContext::send_instruction(&mut ctx.svm, domain_ix, &[&ctx.payer, &owner])
        .expect("create domain config");

    let mut args = sample_create_group_args();
    args.royalty_bps = 10_001;

    let ix = ctx.create_group_token_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        group_mint.pubkey(),
        ctx.domain_config_pda(common::TEST_RP_ID),
        args,
    );
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer, &owner, &group_mint])
        .expect_err("invalid royalty should fail");
    assert!(format!("{err:?}").contains("InvalidRoyaltyBps") || format!("{err:?}").contains("6004"));
}

#[test]
fn create_token_mints_nft_into_collection() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let group_mint = Keypair::new();
    let token_mint = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();

    TestContext::create_collection(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group_mint,
        sample_create_group_args(),
        sample_create_domain_config_args(),
    );

    ctx.fund_program_authority(None);

    let token_ix = ctx.create_token_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        token_mint.pubkey(),
        group_mint.pubkey(),
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
    assert_eq!(Pubkey::from(member.group), group_mint.pubkey());

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
fn set_transfer_config_updates_metadata_and_payer_funds_mint_growth() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let group_mint = Keypair::new();
    let token_mint = Keypair::new();
    let payment_mint = Pubkey::new_from_array([0xAB; 32]);
    let allowed_recipient = Pubkey::new_from_array([0xCD; 32]);

    ctx.svm
        .airdrop(&owner.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();

    TestContext::create_collection(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group_mint,
        sample_create_group_args(),
        sample_create_domain_config_args(),
    );

    ctx.fund_program_authority(None);

    let token_ix = ctx.create_token_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        token_mint.pubkey(),
        group_mint.pubkey(),
        sample_create_token_args(),
    );
    TestContext::send_instruction(&mut ctx.svm, token_ix, &[&ctx.payer, &owner, &token_mint])
        .expect("create token");

    let mint_before = ctx
        .svm
        .get_account(&token_mint.pubkey())
        .expect("token mint before config");
    let data_len_before = mint_before.data.len();
    let lamports_before = mint_before.lamports;

    let owner_balance_before = ctx.svm.get_account(&owner.pubkey()).unwrap().lamports;

    let config_ix = ctx.set_transfer_config_ix(
        owner.pubkey(),
        owner.pubkey(),
        token_mint.pubkey(),
        SetTransferConfigArgs {
            price: u64::MAX,
            payment_token_mint: Some(payment_mint),
            payment_token_program: Some(anchor_spl::token_2022::ID),
            allowed_recipient: Some(allowed_recipient),
        },
    );
    TestContext::send_instruction(&mut ctx.svm, config_ix, &[&owner])
        .expect("set transfer config");

    let mint_after = ctx
        .svm
        .get_account(&token_mint.pubkey())
        .expect("token mint after config");
    assert!(
        mint_after.data.len() > data_len_before,
        "mint data should grow when transfer config values exceed placeholders"
    );
    assert!(
        mint_after.lamports > lamports_before,
        "payer should top up mint rent for metadata growth"
    );

    let owner_balance_after = ctx.svm.get_account(&owner.pubkey()).unwrap().lamports;
    assert!(
        owner_balance_after < owner_balance_before,
        "payer should fund mint rent shortfall"
    );

    let mint_state =
        StateWithExtensions::<SplMint>::unpack(&mint_after.data).expect("unpack mint");
    let metadata = mint_state
        .get_variable_len_extension::<TokenMetadata>()
        .expect("token metadata");

    let price = metadata
        .additional_metadata
        .iter()
        .find(|(key, _)| key == TRANSFER_PRICE_METADATA_KEY)
        .map(|(_, value)| value.as_str())
        .expect("transfer price metadata");
    assert_eq!(price, u64::MAX.to_string());

    let payment = metadata
        .additional_metadata
        .iter()
        .find(|(key, _)| key == PAYMENT_TOKEN_MINT_METADATA_KEY)
        .map(|(_, value)| value.as_str())
        .expect("payment mint metadata");
    assert_eq!(payment, encode_optional_pubkey(Some(payment_mint)));

    let payment_program = metadata
        .additional_metadata
        .iter()
        .find(|(key, _)| key == PAYMENT_TOKEN_PROGRAM_METADATA_KEY)
        .map(|(_, value)| value.as_str())
        .expect("payment token program metadata");
    assert_eq!(
        payment_program,
        encode_optional_pubkey(Some(anchor_spl::token_2022::ID))
    );

    let recipient = metadata
        .additional_metadata
        .iter()
        .find(|(key, _)| key == ALLOWED_RECIPIENT_METADATA_KEY)
        .map(|(_, value)| value.as_str())
        .expect("allowed recipient metadata");
    assert_eq!(recipient, encode_optional_pubkey(Some(allowed_recipient)));
}

#[test]
fn create_token_rejects_metadata_exceeding_max_lengths() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let group_mint = Keypair::new();
    let token_mint = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), 2 * common::LAMPORTS_PER_SOL)
        .unwrap();

    TestContext::create_collection(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group_mint,
        sample_create_group_args(),
        sample_create_domain_config_args(),
    );

    ctx.fund_program_authority(None);

    let mut args = sample_create_token_args();
    args.uri = "https://example.com/".to_string() + &"x".repeat(64);

    let token_ix = ctx.create_token_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        token_mint.pubkey(),
        group_mint.pubkey(),
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
    let group_mint = Keypair::new();

    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let domain_ix = ctx.create_domain_config_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        sample_create_domain_config_args(),
    );
    TestContext::send_instruction(&mut ctx.svm, domain_ix, &[&ctx.payer, &owner])
        .expect("create domain config");

    let mut args = sample_create_group_args();
    args.name = "n".repeat(33);

    let ix = ctx.create_group_token_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        group_mint.pubkey(),
        ctx.domain_config_pda(common::TEST_RP_ID),
        args,
    );
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer, &owner, &group_mint])
        .expect_err("long name should fail");
    assert!(
        format!("{err:?}").contains("MaxLengthExceeded") || format!("{err:?}").contains("6082"),
        "unexpected error: {err:?}"
    );
}
