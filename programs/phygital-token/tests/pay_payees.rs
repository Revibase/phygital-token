//! Who a tap payment may go to: a verified merchant's payee, or a payee the
//! owner allowed.

mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_phygital_token_program_error, Payment, TestContext, SPL_TOKEN};
use phygital_token::{MerchantStatus, SpendPolicyAction};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// A payment to a fresh wallet's token account, co-signed by `merchant`.
fn to_wallet(ctx: &mut TestContext, base: &Payment, payee: Pubkey) -> Payment {
    Payment {
        destination: ctx.create_token_account(payee, base.mint),
        ..base.clone()
    }
}

fn allow(payee: Pubkey, expires_at: i64, uses: Option<u32>) -> SpendPolicyAction {
    SpendPolicyAction::AllowPayee {
        payee,
        expires_at,
        uses,
    }
}

#[test]
fn an_unlisted_wallet_of_a_verified_merchant_is_refused() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let payment = to_wallet(&mut ctx, &setup.payment(5), Pubkey::new_unique());
    assert_phygital_token_program_error(ctx.pay(&setup, &payment), "MerchantNotVerified");
}

#[test]
fn an_unregistered_merchant_is_refused() {
    let mut ctx = TestContext::new();
    let mut setup = ctx.pay_setup(SPL_TOKEN);
    setup.merchant = Keypair::new();
    let payment = setup.payment(5);
    assert_phygital_token_program_error(ctx.pay(&setup, &payment), "MerchantNotVerified");
}

#[test]
fn a_suspended_merchant_is_refused_and_can_be_reinstated() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.set_merchant_status(
        &setup.registrar,
        setup.merchant.pubkey(),
        MerchantStatus::Suspended,
    )
    .unwrap();
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(5)), "MerchantSuspended");
    ctx.set_merchant_status(
        &setup.registrar,
        setup.merchant.pubkey(),
        MerchantStatus::Active,
    )
    .unwrap();
    ctx.pay(&setup, &setup.payment(5)).unwrap();
}

#[test]
fn an_allowed_payee_can_be_paid_without_a_merchant_registration() {
    let mut ctx = TestContext::new();
    let mut setup = ctx.pay_setup(SPL_TOKEN);
    setup.merchant = Keypair::new(); // e.g. a friend's app: any co-signer
    let friend = Pubkey::new_unique();
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![allow(friend, 0, None)],
    )
    .unwrap();
    let payment = to_wallet(&mut ctx, &setup.payment(5), friend);
    ctx.pay(&setup, &payment).unwrap();
    ctx.pay(
        &setup,
        &Payment {
            reference: Pubkey::new_unique(),
            ..payment
        },
    )
    .unwrap();
}

#[test]
fn allowed_payees_share_the_daily_limit() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let friend = Pubkey::new_unique();
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![allow(friend, 0, None)],
    )
    .unwrap();
    ctx.pay(&setup, &setup.payment(70)).unwrap();
    let payment = to_wallet(&mut ctx, &setup.payment(31), friend);
    assert_phygital_token_program_error(ctx.pay(&setup, &payment), "SpendLimitExceeded");
}

#[test]
fn a_one_time_payee_is_used_up() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let friend = Pubkey::new_unique();
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![allow(friend, 0, Some(1))],
    )
    .unwrap();
    let payment = to_wallet(&mut ctx, &setup.payment(5), friend);
    ctx.pay(&setup, &payment).unwrap();
    assert_eq!(
        ctx.spend_policy(setup.token.phygital_token)
            .unwrap()
            .allowed_payees[0]
            .uses_left,
        0
    );
    let again = Payment {
        reference: Pubkey::new_unique(),
        ..payment
    };
    assert_phygital_token_program_error(ctx.pay(&setup, &again), "MerchantNotVerified");
}

#[test]
fn a_payee_allowed_for_today_expires() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let friend = Pubkey::new_unique();
    let expires_at = ctx.now() + 3_600;
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![allow(friend, expires_at, None)],
    )
    .unwrap();
    let payment = to_wallet(&mut ctx, &setup.payment(5), friend);
    ctx.pay(&setup, &payment).unwrap();
    ctx.advance_clock(3_600);
    let later = Payment {
        reference: Pubkey::new_unique(),
        ..payment
    };
    assert_phygital_token_program_error(ctx.pay(&setup, &later), "MerchantNotVerified");
}

#[test]
fn the_owner_can_allow_a_payee_of_a_suspended_merchant() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.set_merchant_status(
        &setup.registrar,
        setup.merchant.pubkey(),
        MerchantStatus::Suspended,
    )
    .unwrap();
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![allow(setup.payee, 0, None)],
    )
    .unwrap();
    ctx.pay(&setup, &setup.payment(5)).unwrap();
}

#[test]
fn a_verified_payment_does_not_use_up_an_allowed_entry() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &setup.owner,
        vec![allow(setup.payee, 0, Some(1))],
    )
    .unwrap();
    ctx.pay(&setup, &setup.payment(5)).unwrap();
    assert_eq!(
        ctx.spend_policy(setup.token.phygital_token)
            .unwrap()
            .allowed_payees[0]
            .uses_left,
        1
    );
}
