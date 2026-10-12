mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use common::{
    allow, assert_phygital_token_program_error, sol_cap, token_approve_ix, token_transfer_ix,
    MintedPhygitalToken, TestContext, LAMPORTS_PER_SOL,
};
use phygital_token::{
    CapArg, Comparison, DataConstraint, DataPredicate, InstructionRule, NumericWidth,
    PhygitalTokenType, PolicyAction, ProgramAccess, ProgramPermission,
};

fn setup(ctx: &mut TestContext, actions: Vec<PolicyAction>) -> (MintedPhygitalToken, Pubkey) {
    let (token, _owner, wallet) = ctx.token_with_policy(PhygitalTokenType::Permanent, actions);
    (token, wallet)
}

fn send_sol(
    ctx: &mut TestContext,
    token: &MintedPhygitalToken,
    wallet: Pubkey,
    lamports: u64,
) -> litesvm::types::TransactionResult {
    let ix = system_instruction::transfer(&wallet, &Pubkey::new_unique(), lamports);
    ctx.send_execute_with_accessory(token, &[ix])
}

#[test]
fn empty_policy_allows_no_program() {
    let mut ctx = TestContext::new();
    let (token, wallet) = setup(&mut ctx, vec![]);
    let result = send_sol(&mut ctx, &token, wallet, LAMPORTS_PER_SOL);
    assert_phygital_token_program_error(result, "ProgramNotAllowed");
}

#[test]
fn restricted_program_only_allows_matching_instructions() {
    let mut ctx = TestContext::new();
    // System transfer (discriminant 2) of at most 1 SOL.
    let rule = InstructionRule {
        selector: vec![2, 0, 0, 0],
        data_length: Some(12),
        account_count: None,
        accounts: vec![],
        arguments: vec![DataConstraint {
            offset: 4,
            predicate: DataPredicate::Unsigned {
                width: NumericWidth::U64,
                comparison: Comparison::LessThanOrEqual,
                value: LAMPORTS_PER_SOL,
            },
        }],
    };
    let (token, wallet) = setup(
        &mut ctx,
        vec![
            PolicyAction::SetProgramPermission(ProgramPermission {
                program_id: anchor_lang::system_program::ID,
                access: ProgramAccess::Restricted(vec![rule]),
            }),
            sol_cap(5 * LAMPORTS_PER_SOL),
        ],
    );

    send_sol(&mut ctx, &token, wallet, LAMPORTS_PER_SOL).expect("within rule");
    let result = send_sol(&mut ctx, &token, wallet, 2 * LAMPORTS_PER_SOL);
    assert_phygital_token_program_error(result, "InstructionNotAllowed");
}

#[test]
fn sol_cap_limits_per_tx_and_per_window() {
    let mut ctx = TestContext::new();
    let (token, wallet) = setup(
        &mut ctx,
        vec![
            allow(anchor_lang::system_program::ID),
            PolicyAction::SetSolCap(Some(CapArg {
                cap: 2 * LAMPORTS_PER_SOL,
                window_seconds: 3_600,
                max_per_tx: 3 * LAMPORTS_PER_SOL / 2,
            })),
        ],
    );

    let result = send_sol(&mut ctx, &token, wallet, 8 * LAMPORTS_PER_SOL / 5);
    assert_phygital_token_program_error(result, "MaxPerTxExceeded");
    send_sol(&mut ctx, &token, wallet, LAMPORTS_PER_SOL).expect("first");
    send_sol(&mut ctx, &token, wallet, LAMPORTS_PER_SOL).expect("second");
    let result = send_sol(&mut ctx, &token, wallet, LAMPORTS_PER_SOL / 2);
    assert_phygital_token_program_error(result, "SpendLimitExceeded");

    ctx.advance_clock(3_600);
    send_sol(&mut ctx, &token, wallet, LAMPORTS_PER_SOL).expect("next window");
    let cap = ctx.policy(token.phygital_token).unwrap().sol_cap.unwrap();
    assert_eq!(cap.remaining, LAMPORTS_PER_SOL);
}

#[test]
fn mint_caps_bound_token_spends_and_block_uncapped_mints() {
    let mut ctx = TestContext::new();
    let capped = ctx.create_mint();
    let uncapped = ctx.create_mint();
    let (token, wallet) = setup(
        &mut ctx,
        vec![
            allow(TOKEN_2022_ID),
            allow(anchor_lang::system_program::ID),
            PolicyAction::SetMintCap(
                capped,
                CapArg {
                    cap: 500,
                    ..Default::default()
                },
            ),
        ],
    );
    let capped_source = ctx.create_token_account(wallet, capped);
    let uncapped_source = ctx.create_token_account(wallet, uncapped);
    let capped_dest = ctx.create_token_account(Pubkey::new_unique(), capped);
    let uncapped_dest = ctx.create_token_account(Pubkey::new_unique(), uncapped);
    ctx.mint_tokens(capped, capped_source, 1_000);
    ctx.mint_tokens(uncapped, uncapped_source, 1_000);

    let ix = token_transfer_ix(capped_source, capped, capped_dest, wallet, 300);
    ctx.send_execute_with_accessory(&token, &[ix])
        .expect("within cap");
    let ix = token_transfer_ix(capped_source, capped, capped_dest, wallet, 300);
    let result = ctx.send_execute_with_accessory(&token, &[ix]);
    assert_phygital_token_program_error(result, "SpendLimitExceeded");
    assert_eq!(ctx.token_balance(capped_dest), 300);

    let ix = token_transfer_ix(uncapped_source, uncapped, uncapped_dest, wallet, 1);
    let result = ctx.send_execute_with_accessory(&token, &[ix]);
    assert_phygital_token_program_error(result, "SpendNotAllowed");

    // The System program is allowed, but SOL has no cap.
    let result = send_sol(&mut ctx, &token, wallet, LAMPORTS_PER_SOL);
    assert_phygital_token_program_error(result, "SpendNotAllowed");
}

#[test]
fn accessory_cannot_leave_a_delegate_on_wallet_tokens() {
    let mut ctx = TestContext::new();
    let mint = ctx.create_mint();
    let (token, wallet) = setup(&mut ctx, vec![allow(TOKEN_2022_ID)]);
    let source = ctx.create_token_account(wallet, mint);
    ctx.mint_tokens(mint, source, 1_000);

    let ix = token_approve_ix(source, mint, Pubkey::new_unique(), wallet, 1_000);
    let result = ctx.send_execute_with_accessory(&token, &[ix]);
    assert_phygital_token_program_error(result, "DelegationNotAllowed");
}

#[test]
fn allowed_programs_without_caps_cannot_move_sol_or_tokens() {
    let mut ctx = TestContext::new();
    let mint = ctx.create_mint();
    let (token, wallet) = setup(
        &mut ctx,
        vec![allow(anchor_lang::system_program::ID), allow(TOKEN_2022_ID)],
    );
    let source = ctx.create_token_account(wallet, mint);
    let destination = ctx.create_token_account(Pubkey::new_unique(), mint);
    ctx.mint_tokens(mint, source, 1_000);

    let result = send_sol(&mut ctx, &token, wallet, 1);
    assert_phygital_token_program_error(result, "SpendNotAllowed");
    let ix = token_transfer_ix(source, mint, destination, wallet, 1);
    let result = ctx.send_execute_with_accessory(&token, &[ix]);
    assert_phygital_token_program_error(result, "SpendNotAllowed");
}
