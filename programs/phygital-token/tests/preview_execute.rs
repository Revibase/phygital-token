mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::system_instruction;
use common::{allow, assert_phygital_token_program_error, sol_cap, TestContext, LAMPORTS_PER_SOL};
use phygital_token::{PhygitalTokenType, PolicyAction};

#[test]
fn preview_reports_whether_a_tap_would_pass() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, 2 * LAMPORTS_PER_SOL).unwrap();
    let destination = Pubkey::new_unique();
    let ix = system_instruction::transfer(&wallet, &destination, LAMPORTS_PER_SOL);

    let result = ctx.send_preview_execute(token.phygital_token, std::slice::from_ref(&ix), None);
    assert_phygital_token_program_error(result, "AccountNotInitialized");

    ctx.send_update_policy(token.phygital_token, &owner, vec![])
        .unwrap();
    let result = ctx.send_preview_execute(token.phygital_token, std::slice::from_ref(&ix), None);
    assert_phygital_token_program_error(result, "ProgramNotAllowed");

    ctx.send_update_policy(
        token.phygital_token,
        &owner,
        vec![
            allow(anchor_lang::system_program::ID),
            sol_cap(LAMPORTS_PER_SOL),
        ],
    )
    .unwrap();
    let result = ctx.send_preview_execute(token.phygital_token, std::slice::from_ref(&ix), None);
    assert_phygital_token_program_error(result, "PreviewPassed");
    assert_eq!(ctx.lamports(&destination), 0);
}

#[test]
fn preview_checks_the_requesting_origin_against_allowed_origins() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, 2 * LAMPORTS_PER_SOL).unwrap();
    let ix = system_instruction::transfer(&wallet, &Pubkey::new_unique(), LAMPORTS_PER_SOL);
    ctx.send_update_policy(
        token.phygital_token,
        &owner,
        vec![
            allow(anchor_lang::system_program::ID),
            sol_cap(LAMPORTS_PER_SOL),
            PolicyAction::SetAllowedOrigins(vec!["https://app.example".to_string()]),
        ],
    )
    .unwrap();

    let result = ctx.send_preview_execute(
        token.phygital_token,
        std::slice::from_ref(&ix),
        Some("https://evil.example"),
    );
    assert_phygital_token_program_error(result, "OriginMismatch");
    let result = ctx.send_preview_execute(
        token.phygital_token,
        std::slice::from_ref(&ix),
        Some("https://app.example"),
    );
    assert_phygital_token_program_error(result, "PreviewPassed");
    // A native client has no origin to check.
    let result = ctx.send_preview_execute(token.phygital_token, &[ix], None);
    assert_phygital_token_program_error(result, "PreviewPassed");
}
