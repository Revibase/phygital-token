mod common;

use common::{
    assert_token_program_error, create_external_group_mint, create_group_mint_without_update_authority,
    create_plain_token2022_mint, sample_create_design_args, TestContext,
};
use phygital_nfts::CreateMintArgs;
use phygital_nfts::utils::constants::{MAX_METADATA_NAME_LEN, MAX_METADATA_SYMBOL_LEN};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn create_mint_rejects_plain_token_mint_as_group() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let plain_mint = create_plain_token2022_mint(&mut ctx.svm, &ctx.payer);
    let args = sample_create_design_args();
    let mint = ctx.mint_pda(plain_mint.pubkey(), args.design_id);
    let fake_authority = Keypair::new();

    let ix = ctx.create_mint_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        fake_authority.pubkey(),
        mint,
        plain_mint.pubkey(),
        args,
    );
    let err = TestContext::send_instruction(
        &mut ctx.svm,
        ix,
        &[&ctx.payer, &owner, &fake_authority],
    );
    assert_token_program_error(err, "InvalidParentGroup");
}

#[test]
fn create_mint_rejects_group_without_update_authority() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let group_mint = create_group_mint_without_update_authority(&mut ctx.svm, &ctx.payer, 100);
    let fake_authority = Keypair::new();
    let args = sample_create_design_args();
    let mint = ctx.mint_pda(group_mint.pubkey(), args.design_id);

    let ix = ctx.create_mint_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        fake_authority.pubkey(),
        mint,
        group_mint.pubkey(),
        args,
    );
    let err = TestContext::send_instruction(
        &mut ctx.svm,
        ix,
        &[&ctx.payer, &owner, &fake_authority],
    );
    assert_token_program_error(err, "InvalidParentGroup");
}

#[test]
fn create_mint_rejects_duplicate_design_id() {
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
    let args = sample_create_design_args();
    let design_id = args.design_id;
    TestContext::create_design(
        &mut ctx.svm,
        ctx.program_id,
        &ctx.payer,
        &owner,
        &group,
        CreateMintArgs {
            name: args.name.clone(),
            symbol: args.symbol.clone(),
            uri: args.uri.clone(),
            design_id,
        },
    );

    let mint = ctx.mint_pda(group.mint.pubkey(), design_id);
    let ix = ctx.create_mint_ix(
        ctx.payer.pubkey(),
        owner.pubkey(),
        group.authority.pubkey(),
        mint,
        group.mint.pubkey(),
        args,
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer, &owner, &group.authority])
        .expect_err("duplicate design_id should fail");
}

#[test]
fn create_mint_rejects_overlong_name() {
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
    args.name = "n".repeat(MAX_METADATA_NAME_LEN + 1);
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
    );
    assert_token_program_error(err, "MaxLengthExceeded");
}

#[test]
fn create_mint_rejects_overlong_symbol() {
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
    args.symbol = "s".repeat(MAX_METADATA_SYMBOL_LEN + 1);
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
    );
    assert_token_program_error(err, "MaxLengthExceeded");
}

#[test]
fn create_mint_allows_permissionless_payer_with_group_authority() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let permissionless_payer = Keypair::new();
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();
    ctx.svm
        .airdrop(&permissionless_payer.pubkey(), 2 * common::LAMPORTS_PER_SOL)
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
    let mint = TestContext::create_design(
        &mut ctx.svm,
        ctx.program_id,
        &permissionless_payer,
        &owner,
        &group,
        args,
    );

    assert!(ctx.svm.get_account(&mint).is_some());
}
