//! `update_spend_policy`, `close_spend_policy`, and closing the policy on every
//! change of owner.

mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_phygital_token_program_error, assert_transaction_failed, daily_limit, TestContext,
    TestPasskey, SPL_TOKEN,
};
use phygital_token::{PhygitalTokenType, SpendPolicyAction};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn the_owner_creates_and_edits_a_policy_paid_by_any_payer() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Bearer);
    let mint = Pubkey::new_unique();
    let payer = Keypair::new();
    ctx.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let ix = ctx.update_spend_policy_ix(
        owner.pubkey(),
        payer.pubkey(),
        token.phygital_token,
        vec![daily_limit(mint, 100, 0)],
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&payer, &owner]).unwrap();

    let policy = ctx.spend_policy(token.phygital_token).unwrap();
    assert_eq!(policy.owner, owner.pubkey());
    assert_eq!(policy.daily_limits.len(), 1);
    assert!(!policy.paused);

    ctx.send_update_spend_policy(
        token.phygital_token,
        &owner,
        vec![
            daily_limit(mint, 50, 10),
            SpendPolicyAction::AllowPayee {
                payee: Pubkey::new_unique(),
                expires_at: 0,
                uses: Some(3),
            },
            SpendPolicyAction::SetTimezone {
                reset_offset: -5 * 3_600,
            },
        ],
    )
    .unwrap();
    let policy = ctx.spend_policy(token.phygital_token).unwrap();
    assert_eq!(policy.daily_limits[0].limit, 50);
    assert_eq!(policy.daily_limits[0].max_per_tap, 10);
    assert_eq!(policy.allowed_payees[0].uses_left, 3);
    assert_eq!(policy.reset_offset, -5 * 3_600);
}

#[test]
fn only_the_owner_edits_the_policy() {
    let mut ctx = TestContext::new();
    let (token, _owner) = ctx.owned_token(PhygitalTokenType::Bearer);
    let impostor = Keypair::new();
    ctx.svm.airdrop(&impostor.pubkey(), 1_000_000_000).unwrap();
    assert_phygital_token_program_error(
        ctx.send_update_spend_policy(
            token.phygital_token,
            &impostor,
            vec![daily_limit(Pubkey::new_unique(), 1, 0)],
        ),
        "OwnerMismatch",
    );
}

#[test]
fn invalid_edits_are_refused() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Bearer);
    let now = ctx.now();
    for action in [
        daily_limit(Pubkey::new_unique(), 0, 0),
        daily_limit(Pubkey::new_unique(), 5, 6),
        SpendPolicyAction::AllowPayee {
            payee: Pubkey::new_unique(),
            expires_at: now,
            uses: None,
        },
        SpendPolicyAction::SetTimezone {
            reset_offset: 15 * 3_600,
        },
        SpendPolicyAction::RemovePayee {
            payee: Pubkey::new_unique(),
        },
    ] {
        assert_phygital_token_program_error(
            ctx.send_update_spend_policy(token.phygital_token, &owner, vec![action]),
            "InvalidPolicyArgs",
        );
    }
}

#[test]
fn expired_payees_are_pruned_on_the_next_edit() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Bearer);
    let expires_at = ctx.now() + 60;
    ctx.send_update_spend_policy(
        token.phygital_token,
        &owner,
        vec![SpendPolicyAction::AllowPayee {
            payee: Pubkey::new_unique(),
            expires_at,
            uses: None,
        }],
    )
    .unwrap();
    let full = ctx.lamports(ctx.spend_policy_pda(token.phygital_token));
    ctx.advance_clock(60);
    ctx.send_update_spend_policy(token.phygital_token, &owner, vec![])
        .unwrap();
    assert!(ctx
        .spend_policy(token.phygital_token)
        .unwrap()
        .allowed_payees
        .is_empty());
    assert_eq!(
        ctx.lamports(ctx.spend_policy_pda(token.phygital_token)),
        full,
        "shrinking keeps the rent until close"
    );
}

#[test]
fn a_prefunded_policy_address_can_still_be_created() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Bearer);
    ctx.svm
        .airdrop(&ctx.spend_policy_pda(token.phygital_token), 1_000)
        .unwrap();
    ctx.send_update_spend_policy(
        token.phygital_token,
        &owner,
        vec![daily_limit(Pubkey::new_unique(), 1, 0)],
    )
    .unwrap();
    assert!(ctx.spend_policy(token.phygital_token).is_some());
}

#[test]
fn the_owner_closes_the_policy_and_takes_back_the_rent() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Bearer);
    ctx.send_update_spend_policy(
        token.phygital_token,
        &owner,
        vec![daily_limit(Pubkey::new_unique(), 1, 0)],
    )
    .unwrap();
    let rent = ctx.lamports(ctx.spend_policy_pda(token.phygital_token));
    let before = ctx.lamports(owner.pubkey());
    ctx.close_spend_policy(token.phygital_token, &owner)
        .unwrap();
    assert!(ctx.spend_policy(token.phygital_token).is_none());
    assert!(ctx.lamports(owner.pubkey()) + 10_000 >= before + rent);
}

#[test]
fn a_new_owner_closes_the_policy_with_rent_to_the_previous_owner() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let pda = ctx.spend_policy_pda(setup.token.phygital_token);
    let rent = ctx.lamports(pda);
    let before = ctx.lamports(setup.owner.pubkey());

    let next = Keypair::new();
    ctx.send_set_owner(&setup.token, &next, true).unwrap();
    assert!(ctx.spend_policy(setup.token.phygital_token).is_none());
    assert_eq!(ctx.lamports(setup.owner.pubkey()), before + rent);
    assert_eq!(ctx.lamports(pda), 0);
    assert!(ctx.pay(&setup, &setup.payment(1)).is_err());
}

#[test]
fn set_owner_refuses_a_wrong_rent_receiver_when_a_policy_exists() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let next = Keypair::new();
    ctx.svm.airdrop(&next.pubkey(), 1_000_000_000).unwrap();
    let (slot_number, slot_hash) = common::current_slot_entry(&ctx.svm);
    let sign_count = ctx.next_sign_count(setup.token.phygital_token);
    let (secp_ix, args) = setup.token.passkey.secp256r1_verify_instruction(
        setup.token.phygital_token,
        slot_hash,
        sign_count,
    );
    let mut ix = ctx.set_owner_ix(next.pubkey(), setup.token.phygital_token, args, slot_number);
    ix.accounts[3].pubkey = next.pubkey(); // previous_owner
    assert_phygital_token_program_error(
        ctx.send_set_owner_with_instructions(vec![secp_ix, ix], &[&next]),
        "OwnerMismatch",
    );
}

#[test]
fn the_same_owner_reclaiming_keeps_the_policy() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.send_set_owner(&setup.token, &setup.owner, true)
        .unwrap();
    assert!(ctx.spend_policy(setup.token.phygital_token).is_some());
    ctx.pay(&setup, &setup.payment(1)).unwrap();
}

#[test]
fn remove_owner_closes_the_policy() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    ctx.send_remove_owner(&setup.token, &setup.owner).unwrap();
    assert!(ctx.spend_policy(setup.token.phygital_token).is_none());
}

#[test]
fn close_phygital_token_closes_the_policy_with_rent_to_the_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let owner = Keypair::new();
    ctx.svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();
    let token =
        ctx.init_phygital_token_with_owner(&passkey, PhygitalTokenType::Permanent, owner.pubkey());
    ctx.send_update_spend_policy(
        token.phygital_token,
        &owner,
        vec![daily_limit(Pubkey::new_unique(), 1, 0)],
    )
    .unwrap();
    let rent = ctx.lamports(ctx.spend_policy_pda(token.phygital_token));
    let before = ctx.lamports(owner.pubkey());
    let recipient = Pubkey::new_unique();
    ctx.send_close_phygital_token(recipient, token.phygital_token)
        .unwrap();
    assert!(ctx.spend_policy(token.phygital_token).is_none());
    assert_eq!(ctx.lamports(owner.pubkey()), before + rent);

    // The owner account must match when a policy exists.
    let token = ctx.init_phygital_token_with_owner(
        &TestPasskey::generate(),
        PhygitalTokenType::Permanent,
        owner.pubkey(),
    );
    ctx.send_update_spend_policy(
        token.phygital_token,
        &owner,
        vec![daily_limit(Pubkey::new_unique(), 1, 0)],
    )
    .unwrap();
    let mut ix = ctx.close_phygital_token_ix(ctx.admin.pubkey(), recipient, token.phygital_token);
    let last = ix.accounts.len() - 1;
    ix.accounts[last].pubkey = recipient;
    let admin = ctx.admin.insecure_clone();
    assert_transaction_failed(TestContext::send_instruction(&mut ctx.svm, ix, &[&admin]));
}
