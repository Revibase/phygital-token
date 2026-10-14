//! `pay_with_accessory`: one tap pays a verified merchant from the owner's
//! delegated account, within the daily limit.

mod common;

use common::{
    assert_phygital_token_program_error, daily_limit, TestContext, SPL_TOKEN, TOKEN_2022,
};
use phygital_token::SpendPolicyAction;
use solana_signer::Signer;

#[test]
fn pays_a_verified_merchant_on_both_token_programs() {
    for program in [SPL_TOKEN, TOKEN_2022] {
        let mut ctx = TestContext::new();
        let setup = ctx.pay_setup(program);
        let meta = ctx.pay(&setup, &setup.payment(30)).expect("pay");
        eprintln!("CU pay_with_accessory: {}", meta.compute_units_consumed);

        assert_eq!(ctx.token_balance(setup.source), 970);
        assert_eq!(ctx.token_balance(setup.destination), 30);
        assert_eq!(
            ctx.delegated_amount(setup.source),
            470,
            "the SPL allowance shrinks too"
        );
        let policy = ctx.spend_policy(setup.token.phygital_token).unwrap();
        assert_eq!(policy.daily_limits[0].spent, 30);
        assert_eq!(ctx.last_sign_count(setup.token.phygital_token), 2);
    }
}

#[test]
fn daily_limit_resets_at_the_owners_local_midnight() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    // UTC+8: the day starts at 16:00 UTC.
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![SpendPolicyAction::SetTimezone {
            reset_offset: 8 * 3_600,
        }],
    )
    .unwrap();
    ctx.pay(&setup, &setup.payment(60)).unwrap();
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(41)), "SpendLimitExceeded");
    ctx.pay(&setup, &setup.payment(40)).unwrap();

    let now = ctx.now();
    let local = now + 8 * 3_600;
    let to_local_midnight = 86_400 - local.rem_euclid(86_400);
    ctx.advance_clock(to_local_midnight - 1);
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(1)), "SpendLimitExceeded");
    ctx.advance_clock(1);
    ctx.pay(&setup, &setup.payment(100)).expect("a new day");
}

#[test]
fn max_per_tap_applies_when_set() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![daily_limit(setup.mint, 100, 25)],
    )
    .unwrap();
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(26)), "MaxPerTxExceeded");
    ctx.pay(&setup, &setup.payment(25)).unwrap();
}

#[test]
fn a_mint_without_a_daily_limit_cannot_be_paid() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![SpendPolicyAction::RemoveDailyLimit { mint: setup.mint }],
    )
    .unwrap();
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(1)), "SpendNotAllowed");
}

#[test]
fn zero_amounts_and_paused_accessories_are_refused() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(0)), "ZeroAmount");
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![SpendPolicyAction::SetPaused { paused: true }],
    )
    .unwrap();
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(1)), "TapPaymentsPaused");
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![SpendPolicyAction::SetPaused { paused: false }],
    )
    .unwrap();
    ctx.pay(&setup, &setup.payment(1)).unwrap();
}

#[test]
fn the_spl_allowance_is_an_independent_ceiling() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let delegate = ctx.delegate_pda(setup.owner.pubkey());
    ctx.approve(setup.source, setup.mint, delegate, &setup.owner, 20)
        .unwrap();
    // Within the daily limit, but over the allowance: the token program refuses.
    assert!(ctx.pay(&setup, &setup.payment(21)).is_err());
    ctx.pay(&setup, &setup.payment(20)).unwrap();
    // A used-up allowance clears the delegate.
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(1)), "DelegateMismatch");
}

#[test]
fn revoking_the_delegation_stops_payments() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(TOKEN_2022);
    ctx.revoke(setup.source, setup.mint, &setup.owner).unwrap();
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(1)), "DelegateMismatch");
}

#[test]
fn frozen_accounts_fail_in_the_token_program() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.freeze(setup.source, setup.mint);
    assert!(ctx.pay(&setup, &setup.payment(1)).is_err());
    assert_eq!(ctx.token_balance(setup.destination), 0);
}

#[test]
fn limits_count_the_amount_debited_for_transfer_fee_mints() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(phygital_token::PhygitalTokenType::Bearer);
    let mint = ctx.create_fee_mint(1_000, 1_000); // 10%
    let setup = ctx.pay_setup_for(token, owner, mint);
    ctx.pay(&setup, &setup.payment(50)).unwrap();
    assert_eq!(ctx.token_balance(setup.source), 950);
    assert_eq!(
        ctx.token_balance(setup.destination),
        45,
        "the fee is withheld"
    );
    let policy = ctx.spend_policy(setup.token.phygital_token).unwrap();
    assert_eq!(policy.daily_limits[0].spent, 50);
}

#[test]
fn a_token_without_a_spend_policy_cannot_pay() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.close_spend_policy(setup.token.phygital_token, &setup.owner)
        .unwrap();
    assert!(ctx.pay(&setup, &setup.payment(1)).is_err());
}
