mod common;

use anchor_lang::prelude::Rent;
use common::{
    assert_transaction_failed, build_design_mint_instructions, create_external_group_mint,
    create_group_mint_without_update_authority, create_plain_token2022_mint,
    sample_create_mint_args, CreateMintArgs, DesignMintSigners, TestContext,
};
use phygital_token::utils::constants::{MAX_METADATA_NAME_LEN, MAX_METADATA_SYMBOL_LEN};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn create_mint_rejects_plain_token_mint_as_group() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let payer = &ctx.payer;
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let plain_mint = create_plain_token2022_mint(&mut ctx.svm, payer);
    let args = sample_create_mint_args();
    let mint = Keypair::new();
    let fake_authority = Keypair::new();

    let instructions = build_design_mint_instructions(
        ctx.program_id,
        &ctx.svm.get_sysvar(),
        DesignMintSigners {
            payer,
            owner: &owner,
            mint_authority: &owner,
            group_mint_authority: &fake_authority,
            mint: &mint,
        },
        plain_mint.pubkey(),
        &args,
    )
    .expect("build design mint instructions");

    // A plain mint has no token-group extension, so token-2022's member init fails.
    let err = TestContext::send_instructions(
        &mut ctx.svm,
        &instructions,
        &[payer, &owner, &fake_authority, &mint],
    );
    assert_transaction_failed(err);
}

#[test]
fn create_mint_rejects_group_without_update_authority() {
    let mut ctx = TestContext::new();
    let owner = Keypair::new();
    let payer = &ctx.payer;
    ctx.svm
        .airdrop(&owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let group_mint = create_group_mint_without_update_authority(&mut ctx.svm, payer, 100);
    let fake_authority = Keypair::new();
    let args = sample_create_mint_args();
    let mint = Keypair::new();

    let instructions = build_design_mint_instructions(
        ctx.program_id,
        &ctx.svm.get_sysvar(),
        DesignMintSigners {
            payer,
            owner: &owner,
            mint_authority: &owner,
            group_mint_authority: &fake_authority,
            mint: &mint,
        },
        group_mint.pubkey(),
        &args,
    )
    .expect("build design mint instructions");

    // Without a valid group update authority, token-2022's member init fails.
    let err = TestContext::send_instructions(
        &mut ctx.svm,
        &instructions,
        &[payer, &owner, &fake_authority, &mint],
    );
    assert_transaction_failed(err);
}

#[test]
fn create_mint_rejects_overlong_name() {
    let owner = Keypair::new();
    let payer = Keypair::new();
    let group_authority = Keypair::new();
    let mint = Keypair::new();
    let group_mint = Keypair::new();

    let mut args = sample_create_mint_args();
    args.name = "n".repeat(MAX_METADATA_NAME_LEN + 1);

    let err = build_design_mint_instructions(
        phygital_token::ID,
        &Rent::default(),
        DesignMintSigners {
            payer: &payer,
            owner: &owner,
            mint_authority: &owner,
            group_mint_authority: &group_authority,
            mint: &mint,
        },
        group_mint.pubkey(),
        &args,
    )
    .expect_err("long name should fail validation");
    assert!(format!("{err:?}").contains("MaxLengthExceeded"));
}

#[test]
fn create_mint_rejects_overlong_symbol() {
    let owner = Keypair::new();
    let payer = Keypair::new();
    let group_authority = Keypair::new();
    let mint = Keypair::new();
    let group_mint = Keypair::new();

    let mut args = sample_create_mint_args();
    args.symbol = "s".repeat(MAX_METADATA_SYMBOL_LEN + 1);

    let err = build_design_mint_instructions(
        phygital_token::ID,
        &Rent::default(),
        DesignMintSigners {
            payer: &payer,
            owner: &owner,
            mint_authority: &owner,
            group_mint_authority: &group_authority,
            mint: &mint,
        },
        group_mint.pubkey(),
        &args,
    )
    .expect_err("long symbol should fail validation");
    assert!(format!("{err:?}").contains("MaxLengthExceeded"));
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
    let args = sample_create_mint_args();
    let mint = TestContext::create_mint(
        &mut ctx.svm,
        ctx.program_id,
        &permissionless_payer,
        &owner,
        &group,
        args,
    );

    assert!(ctx.svm.get_account(&mint).is_some());
}
