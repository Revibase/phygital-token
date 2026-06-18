mod common;

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as SplMint;
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata;
use common::{
    create_external_group_mint, current_slot_entry, sample_create_mint_args, MintedAsset,
    TestContext, TestPasskey, LAMPORTS_PER_SOL,
};
use phygital_token::MintTokenArgs;
use phygital_token::Secp256r1Pubkey;
use solana_keypair::Keypair;
use solana_signer::Signer;
use spl_token_group_interface::state::TokenGroupMember;

fn setup_e2e_asset(ctx: &mut TestContext, passkey: &TestPasskey) -> MintedAsset {
    let design_owner = Keypair::new();
    let recipient = Keypair::new();

    ctx.svm
        .airdrop(&design_owner.pubkey(), 2 * LAMPORTS_PER_SOL)
        .unwrap();
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .unwrap();

    let group = create_external_group_mint(
        &mut ctx.svm,
        &ctx.payer,
        "Test Collection",
        "TCOL",
        common::SAMPLE_ASSET_URI,
        100,
    );
    let group_mint = group.mint.pubkey();

    let mint = TestContext::create_mint(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &design_owner,
        &group,
        sample_create_mint_args(),
    );

    let design_account = ctx.svm.get_account(&mint).expect("design mint");
    let design_state =
        StateWithExtensions::<SplMint>::unpack(&design_account.data).expect("unpack design mint");
    let member = design_state
        .get_extension::<TokenGroupMember>()
        .expect("group member extension");
    assert_eq!(Pubkey::from(member.group), group_mint);

    let metadata = design_state
        .get_variable_len_extension::<TokenMetadata>()
        .expect("token metadata");
    assert_eq!(metadata.name, "Test Design");

    ctx.fund_program_authority(None);

    let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
    let asset = ctx.asset_pda(&secp256r1_pubkey);
    let token_args = MintTokenArgs {
        secp256r1_pubkey,
        lock_asset_on_create: None,
    };

    let token_ix = ctx.mint_token_ix(ctx.payer.pubkey(), asset, mint, token_args);
    TestContext::send_instruction(&mut ctx.svm, token_ix, &[&ctx.payer]).expect("create token");

    assert_eq!(ctx.token_balance(ctx.program_authority(), mint), 1);

    MintedAsset {
        design_owner,
        recipient,
        mint,
        asset,
        group_mint,
        passkey: passkey.clone(),
    }
}

#[test]
fn e2e_external_collection_mint_and_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = setup_e2e_asset(&mut ctx, &passkey);
    let recipient = Keypair::new();

    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 0);

    let (transfer_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("execute_transfer should succeed");

    assert_eq!(
        ctx.last_transfer_slot(asset.asset),
        transfer_slot,
        "asset instance should record the slot used for the transfer"
    );
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 0);
    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 1);
}

#[test]
fn e2e_execute_transfer_rejects_group_mint_as_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = setup_e2e_asset(&mut ctx, &passkey);
    let recipient = Keypair::new();

    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);

    let result = ctx.send_execute_transfer_for_mint(
        &asset,
        ctx.program_authority(),
        &recipient,
        asset.group_mint,
        true,
    );

    let err_str = format!(
        "{:?}",
        result.expect_err("group mint as design should fail")
    );
    assert!(
        err_str.contains("MintMismatch")
            || err_str.contains("AccountNotInitialized")
            || err_str.contains("ConstraintRaw")
            || err_str.contains("3012"),
        "unexpected error: {err_str}"
    );
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 0);
}
