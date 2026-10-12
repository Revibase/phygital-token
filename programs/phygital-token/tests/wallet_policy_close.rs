mod common;

use anchor_lang::prelude::{Pubkey, ToAccountMetas};
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::InstructionData;
use common::{allow, assert_phygital_token_program_error, TestContext, LAMPORTS_PER_SOL};
use phygital_token::{PhygitalTokenType, PolicyAction};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn allow_system_program() -> Vec<PolicyAction> {
    vec![allow(anchor_lang::system_program::ID)]
}

fn token_with_paid_policy(
    ctx: &mut TestContext,
    token_type: PhygitalTokenType,
) -> (common::MintedPhygitalToken, Keypair, Keypair) {
    let (token, owner) = ctx.owned_token(token_type);
    let paymaster = Keypair::new();
    ctx.svm
        .airdrop(&paymaster.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();
    let ix = ctx.update_policy_ix(
        owner.pubkey(),
        paymaster.pubkey(),
        token.phygital_token,
        allow_system_program(),
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&paymaster, &owner]).expect("policy");
    (token, owner, paymaster)
}

#[test]
fn owner_closes_policy_to_the_wallet() {
    let mut ctx = TestContext::new();
    let (token, owner, paymaster) = token_with_paid_policy(&mut ctx, PhygitalTokenType::Permanent);
    let policy_lamports = ctx.lamports(&ctx.policy_pda(token.phygital_token));
    let wallet = ctx.wallet_pda(token.phygital_token);
    let paymaster_before = ctx.lamports(&paymaster.pubkey());

    for wrong in [Pubkey::new_unique(), paymaster.pubkey()] {
        let ix = ctx.close_policy_ix(owner.pubkey(), token.phygital_token, wrong);
        let result = TestContext::send_instruction(&mut ctx.svm, ix, &[&owner]);
        assert_phygital_token_program_error(result, "ConstraintHasOne");
    }

    let ix = ctx.close_policy_ix(owner.pubkey(), token.phygital_token, wallet);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&owner]).expect("close policy");
    assert!(ctx.policy(token.phygital_token).is_none());
    assert_eq!(ctx.lamports(&wallet), policy_lamports);
    assert_eq!(ctx.lamports(&paymaster.pubkey()), paymaster_before);
}

#[test]
fn only_the_owner_closes_the_policy() {
    let mut ctx = TestContext::new();
    let (token, _owner, _paymaster) =
        token_with_paid_policy(&mut ctx, PhygitalTokenType::Permanent);
    let attacker = Keypair::new();
    ctx.svm
        .airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let wallet = ctx.wallet_pda(token.phygital_token);
    let ix = ctx.close_policy_ix(attacker.pubkey(), token.phygital_token, wallet);
    let result = TestContext::send_instruction(&mut ctx.svm, ix, &[&attacker]);
    assert_phygital_token_program_error(result, "OwnerMismatch");
}

#[test]
fn remove_owner_closes_policy_to_the_wallet() {
    let mut ctx = TestContext::new();
    let (token, owner, _paymaster) =
        token_with_paid_policy(&mut ctx, PhygitalTokenType::Controlled);
    let policy_lamports = ctx.lamports(&ctx.policy_pda(token.phygital_token));
    let wallet = ctx.wallet_pda(token.phygital_token);

    ctx.send_remove_owner(&token, &owner).expect("remove owner");

    assert!(ctx.policy(token.phygital_token).is_none());
    // An empty wallet ends up rent-exempt: the refund is above its minimum.
    assert_eq!(ctx.lamports(&wallet), policy_lamports);
}

#[test]
fn remove_owner_requires_the_wallet_and_policy_pdas() {
    let mut ctx = TestContext::new();
    let (token, owner, paymaster) = token_with_paid_policy(&mut ctx, PhygitalTokenType::Controlled);

    let wrong_wallet = Instruction {
        program_id: ctx.program_id,
        accounts: phygital_token::accounts::RemoveOwner {
            owner: owner.pubkey(),
            phygital_token: token.phygital_token,
            policy: ctx.policy_pda(token.phygital_token),
            wallet: paymaster.pubkey(),
        }
        .to_account_metas(None),
        data: phygital_token::instruction::RemoveOwner {}.data(),
    };
    let result = TestContext::send_instruction(&mut ctx.svm, wrong_wallet, &[&owner]);
    assert_phygital_token_program_error(result, "ConstraintSeeds");

    let mut wrong_policy = ctx.remove_owner_ix(owner.pubkey(), token.phygital_token);
    wrong_policy.accounts[2].pubkey = Pubkey::new_unique();
    let result = TestContext::send_instruction(&mut ctx.svm, wrong_policy, &[&owner]);
    assert_phygital_token_program_error(result, "ConstraintSeeds");

    assert!(ctx.policy(token.phygital_token).is_some());
}

#[test]
fn admin_close_sends_policy_rent_to_the_rent_recipient() {
    let mut ctx = TestContext::new();
    let (token, _owner, _paymaster) =
        token_with_paid_policy(&mut ctx, PhygitalTokenType::Permanent);
    let policy_lamports = ctx.lamports(&ctx.policy_pda(token.phygital_token));
    let token_lamports = ctx.lamports(&token.phygital_token);
    let wallet = ctx.wallet_pda(token.phygital_token);
    let admin = ctx.admin.pubkey();
    let admin_before = ctx.lamports(&admin);

    ctx.send_close_phygital_token(admin, token.phygital_token)
        .expect("close token");

    assert!(ctx.policy(token.phygital_token).is_none());
    assert_eq!(ctx.lamports(&wallet), 0);
    assert!(ctx.lamports(&admin) + 10_000 >= admin_before + policy_lamports + token_lamports);
}

#[test]
fn bearer_relink_returns_the_previous_policy_rent_to_the_wallet() {
    let mut ctx = TestContext::new();
    let (token, _owner, _paymaster) = token_with_paid_policy(&mut ctx, PhygitalTokenType::Bearer);
    let policy_lamports = ctx.lamports(&ctx.policy_pda(token.phygital_token));
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, 2 * LAMPORTS_PER_SOL).unwrap();

    let new_holder = Keypair::new();
    ctx.send_set_owner(&token, &new_holder, true)
        .expect("re-link");

    assert_eq!(
        ctx.phygital_token_owner(token.phygital_token),
        new_holder.pubkey()
    );
    assert!(ctx.policy(token.phygital_token).is_none());
    assert_eq!(
        ctx.lamports(&wallet),
        2 * LAMPORTS_PER_SOL + policy_lamports
    );

    // The new holder starts blocked, but owns the wallet.
    let ix = system_instruction::transfer(&wallet, &new_holder.pubkey(), LAMPORTS_PER_SOL);
    let result = ctx.send_execute_with_accessory(&token, &[ix.clone()]);
    assert_phygital_token_program_error(result, "AccountNotInitialized");
    ctx.send_execute_with_owner(token.phygital_token, &new_holder, &[ix])
        .expect("new owner executes");
}

#[test]
fn bearer_relink_to_the_same_owner_keeps_the_policy() {
    let mut ctx = TestContext::new();
    let (token, owner, _paymaster) = token_with_paid_policy(&mut ctx, PhygitalTokenType::Bearer);

    ctx.send_set_owner(&token, &owner, true).expect("re-link");
    assert!(ctx.policy(token.phygital_token).is_some());
}

#[test]
fn prefunded_policy_address_can_still_be_created() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Permanent);
    let address = ctx.policy_pda(token.phygital_token);
    ctx.svm.airdrop(&address, 1_000).unwrap();

    ctx.send_update_policy(token.phygital_token, &owner, allow_system_program())
        .expect("create over pre-funded PDA");
    assert_eq!(
        ctx.policy(token.phygital_token).unwrap().wallet,
        ctx.wallet_pda(token.phygital_token)
    );
}
