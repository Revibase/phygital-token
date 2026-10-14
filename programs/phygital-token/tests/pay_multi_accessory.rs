//! One owner, several accessories: one delegate per owner, one allowance,
//! separate daily limits.

mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_phygital_token_program_error, daily_limit, Payment, TestContext, TestPasskey, SPL_TOKEN,
};
use phygital_token::PhygitalTokenType;
use solana_signer::Signer;

#[test]
fn two_accessories_share_the_owners_delegated_account_under_separate_limits() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);

    let second =
        ctx.init_phygital_token_of_type(&TestPasskey::generate(), PhygitalTokenType::Bearer);
    ctx.send_set_owner(&second, &setup.owner, true).unwrap();
    ctx.send_update_spend_policy(
        second.phygital_token,
        &setup.owner,
        vec![daily_limit(setup.mint, 40, 0)],
    )
    .unwrap();

    ctx.pay(&setup, &setup.payment(90)).unwrap();
    let from_second = Payment {
        phygital_token: second.phygital_token,
        ..setup.payment(40)
    };
    let instructions = ctx.pay_instructions(&second.passkey, &from_second, &from_second);
    let merchant = setup.merchant.insecure_clone();
    TestContext::send_instructions(&mut ctx.svm, &instructions, &[&merchant]).unwrap();

    assert_eq!(ctx.token_balance(setup.source), 870);
    assert_eq!(
        ctx.delegated_amount(setup.source),
        370,
        "one shared allowance"
    );
    let over = Payment {
        phygital_token: second.phygital_token,
        ..setup.payment(1)
    };
    let instructions = ctx.pay_instructions(&second.passkey, &over, &over);
    assert_phygital_token_program_error(
        TestContext::send_instructions(&mut ctx.svm, &instructions, &[&merchant]),
        "SpendLimitExceeded",
    );
}

#[test]
fn a_tap_from_one_accessory_cannot_pay_as_another() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let other = TestPasskey::generate();
    let payment = setup.payment(5);
    let instructions = ctx.pay_instructions(&other, &payment, &payment);
    let merchant = setup.merchant.insecure_clone();
    ctx.svm.airdrop(&merchant.pubkey(), 1_000_000_000).unwrap();
    assert_phygital_token_program_error(
        TestContext::send_instructions(&mut ctx.svm, &instructions, &[&merchant]),
        "Secp256r1PubkeyMismatch",
    );
}

#[test]
fn a_reowned_accessory_cannot_reach_the_previous_owners_accounts() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let second =
        ctx.init_phygital_token_of_type(&TestPasskey::generate(), PhygitalTokenType::Bearer);
    ctx.send_set_owner(&second, &setup.owner, true).unwrap();
    ctx.send_update_spend_policy(
        second.phygital_token,
        &setup.owner,
        vec![daily_limit(setup.mint, 100, 0)],
    )
    .unwrap();

    // Someone else claims the first accessory and sets up their own limits.
    let thief = solana_keypair::Keypair::new();
    ctx.send_set_owner(&setup.token, &thief, true).unwrap();
    ctx.send_update_spend_policy(
        setup.token.phygital_token,
        &thief,
        vec![daily_limit(setup.mint, 100, 0)],
    )
    .unwrap();
    assert_phygital_token_program_error(ctx.pay(&setup, &setup.payment(5)), "InvalidTokenAccount");

    // The owner's other accessory still pays.
    let payment = Payment {
        phygital_token: second.phygital_token,
        reference: Pubkey::new_unique(),
        ..setup.payment(5)
    };
    let instructions = ctx.pay_instructions(&second.passkey, &payment, &payment);
    let merchant = setup.merchant.insecure_clone();
    TestContext::send_instructions(&mut ctx.svm, &instructions, &[&merchant]).unwrap();
    assert_eq!(ctx.token_balance(setup.destination), 5);
}
