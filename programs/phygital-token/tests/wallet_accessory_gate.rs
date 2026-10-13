mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::system_instruction;
use common::{
    allow, assert_phygital_token_program_error, current_slot_entry, sol_cap, TestContext,
    LAMPORTS_PER_SOL,
};
use phygital_token::{PhygitalTokenType, PolicyAction};

fn token_with_policy(
    ctx: &mut TestContext,
    token_type: PhygitalTokenType,
) -> (common::MintedPhygitalToken, solana_keypair::Keypair, Pubkey) {
    ctx.token_with_policy(
        token_type,
        vec![
            allow(anchor_lang::system_program::ID),
            sol_cap(5 * LAMPORTS_PER_SOL),
        ],
    )
}

#[test]
fn accessory_is_blocked_without_a_policy() {
    let mut ctx = TestContext::new();
    let (token, _owner) = ctx.owned_token(PhygitalTokenType::Permanent);
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, LAMPORTS_PER_SOL).unwrap();
    let ix = system_instruction::transfer(&wallet, &Pubkey::new_unique(), LAMPORTS_PER_SOL);

    let result = ctx.send_execute_with_accessory(&token, &[ix]);
    assert_phygital_token_program_error(result, "AccountNotInitialized");
}

#[test]
fn accessory_executes_on_locked_permanent_and_controlled_tokens() {
    for token_type in [PhygitalTokenType::Permanent, PhygitalTokenType::Controlled] {
        let mut ctx = TestContext::new();
        let (token, _owner, wallet) = token_with_policy(&mut ctx, token_type);
        assert!(ctx.phygital_token_lock_state(token.phygital_token));
        let before = ctx.last_sign_count(token.phygital_token);
        let destination = Pubkey::new_unique();
        let ix = system_instruction::transfer(&wallet, &destination, LAMPORTS_PER_SOL);

        ctx.send_execute_with_accessory(&token, &[ix])
            .expect("accessory execute");

        assert_eq!(ctx.lamports(&destination), LAMPORTS_PER_SOL);
        assert_eq!(ctx.last_sign_count(token.phygital_token), before + 1);
    }
}

#[test]
fn accessory_executes_on_unlocked_bearer_token() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) = token_with_policy(&mut ctx, PhygitalTokenType::Bearer);
    assert!(!ctx.phygital_token_lock_state(token.phygital_token));
    let destination = Pubkey::new_unique();
    let ix = system_instruction::transfer(&wallet, &destination, LAMPORTS_PER_SOL);

    ctx.send_execute_with_accessory(&token, &[ix])
        .expect("accessory execute");
    assert_eq!(ctx.lamports(&destination), LAMPORTS_PER_SOL);
}

#[test]
fn initialize_stores_the_canonical_wallet_bump() {
    let mut ctx = TestContext::new();
    let (token, _owner) = ctx.owned_token(PhygitalTokenType::Permanent);
    let (wallet, bump) = Pubkey::find_program_address(
        &[phygital_token::WALLET_SEED, token.phygital_token.as_ref()],
        &phygital_token::ID,
    );
    assert_eq!(wallet, ctx.wallet_pda(token.phygital_token));
    assert_eq!(
        ctx.phygital_token_account(token.phygital_token).wallet_bump,
        bump
    );
}

#[test]
fn accessory_is_blocked_after_owner_removal() {
    let mut ctx = TestContext::new();
    let (token, owner, wallet) = token_with_policy(&mut ctx, PhygitalTokenType::Controlled);
    ctx.send_remove_owner(&token, &owner).expect("remove owner");
    assert!(ctx.policy(token.phygital_token).is_none());
    let ix = system_instruction::transfer(&wallet, &Pubkey::new_unique(), LAMPORTS_PER_SOL);

    let result = ctx.send_execute_with_accessory(&token, &[ix]);
    assert_phygital_token_program_error(result, "AccountNotInitialized");
}

#[test]
fn tap_cannot_be_replayed() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) = token_with_policy(&mut ctx, PhygitalTokenType::Permanent);
    let ix = system_instruction::transfer(&wallet, &Pubkey::new_unique(), LAMPORTS_PER_SOL);
    let (secp_ix, execute_ix) = ctx.execute_with_accessory_ixs(&token, &[ix]);
    let payer = ctx.payer.insecure_clone();
    let tap = [secp_ix, execute_ix];

    TestContext::send_instructions(&mut ctx.svm, &tap, &[&payer]).expect("first tap");
    let result = TestContext::send_instructions(&mut ctx.svm, &tap, &[&payer]);
    assert_phygital_token_program_error(result, "StaleSignCount");
}

#[test]
fn tap_is_bound_to_the_signed_instructions_and_slot() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) = token_with_policy(&mut ctx, PhygitalTokenType::Permanent);
    let destination = Pubkey::new_unique();
    let signed = [system_instruction::transfer(
        &wallet,
        &destination,
        LAMPORTS_PER_SOL,
    )];
    let swapped = [system_instruction::transfer(
        &wallet,
        &destination,
        3 * LAMPORTS_PER_SOL,
    )];

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let challenge = ctx.execute_challenge(token.phygital_token, &signed, slot_hash);
    let sign_count = ctx.next_sign_count(token.phygital_token);
    let (secp_ix, args) = token
        .passkey
        .secp256r1_instruction_for_challenge(challenge, sign_count);
    let payer = ctx.payer.insecure_clone();
    let token_key = token.phygital_token;

    for (instructions, slot, error) in [
        (&swapped, slot_number, "ChallengeHashMismatch"),
        (&signed, slot_number + 1, "InvalidSlotHash"),
    ] {
        let ix = ctx.execute_with_accessory_ix(token_key, instructions, args.clone(), slot);
        let result =
            TestContext::send_instructions(&mut ctx.svm, &[secp_ix.clone(), ix], &[&payer]);
        assert_phygital_token_program_error(result, error);
    }

    let ix = ctx.execute_with_accessory_ix(token_key, &signed, args, slot_number);
    TestContext::send_instructions(&mut ctx.svm, &[secp_ix, ix], &[&payer])
        .expect("signed instructions");
    assert_eq!(ctx.lamports(&destination), LAMPORTS_PER_SOL);
}

#[test]
fn accessory_requires_an_owner_even_if_a_policy_survived() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) = token_with_policy(&mut ctx, PhygitalTokenType::Bearer);
    // Unreachable through the instructions (removing the owner closes the
    // policy); checked in case a future instruction forgets to.
    let mut account = ctx.svm.get_account(&token.phygital_token).unwrap();
    account.data[8..40].fill(0);
    ctx.svm.set_account(token.phygital_token, account).unwrap();
    let ix = system_instruction::transfer(&wallet, &Pubkey::new_unique(), 1);

    let result = ctx.send_execute_with_accessory(&token, &[ix]);
    assert_phygital_token_program_error(result, "OwnerRequired");
}

#[test]
fn accessory_execute_rejects_another_tokens_policy_or_wallet() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) = token_with_policy(&mut ctx, PhygitalTokenType::Permanent);
    let (other, _, other_wallet) = token_with_policy(&mut ctx, PhygitalTokenType::Permanent);
    let ix = [system_instruction::transfer(
        &wallet,
        &Pubkey::new_unique(),
        1,
    )];
    let payer = ctx.payer.insecure_clone();

    for (position, substitute, error) in [
        (1, ctx.policy_pda(other.phygital_token), "ConstraintHasOne"),
        (2, other_wallet, "ConstraintAddress"),
    ] {
        let (secp_ix, mut execute_ix) = ctx.execute_with_accessory_ixs(&token, &ix);
        execute_ix.accounts[position].pubkey = substitute;
        let result =
            TestContext::send_instructions(&mut ctx.svm, &[secp_ix, execute_ix], &[&payer]);
        assert_phygital_token_program_error(result, error);
    }
}

#[test]
fn owner_can_limit_which_origins_accessory_taps_come_from() {
    let mut ctx = TestContext::new();
    let (token, owner, wallet) = token_with_policy(&mut ctx, PhygitalTokenType::Permanent);
    let ix = || system_instruction::transfer(&wallet, &Pubkey::new_unique(), 1);
    let origins = |list: &[&str]| {
        vec![PolicyAction::SetAllowedOrigins(
            list.iter().map(|o| o.to_string()).collect(),
        )]
    };

    ctx.send_update_policy(
        token.phygital_token,
        &owner,
        origins(&["https://app.example"]),
    )
    .unwrap();
    let result = ctx.send_execute_with_accessory(&token, &[ix()]);
    assert_phygital_token_program_error(result, "OriginMismatch");

    let allowed = origins(&["https://app.example", common::TEST_ORIGIN]);
    ctx.send_update_policy(token.phygital_token, &owner, allowed)
        .unwrap();
    ctx.send_execute_with_accessory(&token, &[ix()])
        .expect("tap from an allowed origin");

    for invalid in [
        &["https://app.example/"][..],
        &["https://App.example"],
        &["http://app.example"],
        &["app.example"],
        &["https://app.example:"],
        &["https://app.example", "https://app.example"],
    ] {
        let result = ctx.send_update_policy(token.phygital_token, &owner, origins(invalid));
        assert_phygital_token_program_error(result, "InvalidPolicyArgs");
    }

    ctx.send_update_policy(token.phygital_token, &owner, origins(&[]))
        .unwrap();
    assert!(ctx
        .policy(token.phygital_token)
        .unwrap()
        .allowed_origins
        .is_empty());
    ctx.send_execute_with_accessory(&token, &[ix()])
        .expect("empty list allows any origin");
}
