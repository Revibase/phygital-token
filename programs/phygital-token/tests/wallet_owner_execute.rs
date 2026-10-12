mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::system_instruction;
use common::{
    assert_phygital_token_program_error, token_transfer_ix, TestContext, LAMPORTS_PER_SOL,
};
use phygital_token::PhygitalTokenType;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn owner_moves_sol_from_wallet_without_a_policy() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, 5 * LAMPORTS_PER_SOL).unwrap();
    let destination = Pubkey::new_unique();

    ctx.send_execute_with_owner(
        token.phygital_token,
        &owner,
        &[system_instruction::transfer(
            &wallet,
            &destination,
            2 * LAMPORTS_PER_SOL,
        )],
    )
    .expect("owner execute");

    assert!(ctx.policy(token.phygital_token).is_none());
    assert_eq!(ctx.lamports(&destination), 2 * LAMPORTS_PER_SOL);
    assert_eq!(ctx.lamports(&wallet), 3 * LAMPORTS_PER_SOL);
}

#[test]
fn owner_moves_spl_tokens_from_wallet() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Bearer);
    let wallet = ctx.wallet_pda(token.phygital_token);
    let mint = ctx.create_mint();
    let source = ctx.create_token_account(wallet, mint);
    let destination = ctx.create_token_account(Pubkey::new_unique(), mint);
    ctx.mint_tokens(mint, source, 1_000);

    ctx.send_execute_with_owner(
        token.phygital_token,
        &owner,
        &[token_transfer_ix(source, mint, destination, wallet, 400)],
    )
    .expect("owner execute");

    assert_eq!(ctx.token_balance(source), 600);
    assert_eq!(ctx.token_balance(destination), 400);
}

#[test]
fn non_owner_cannot_execute() {
    let mut ctx = TestContext::new();
    let (token, _owner) = ctx.owned_token(PhygitalTokenType::Permanent);
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, LAMPORTS_PER_SOL).unwrap();
    let attacker = Keypair::new();
    ctx.svm
        .airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let result = ctx.send_execute_with_owner(
        token.phygital_token,
        &attacker,
        &[system_instruction::transfer(
            &wallet,
            &attacker.pubkey(),
            LAMPORTS_PER_SOL,
        )],
    );
    assert_phygital_token_program_error(result, "OwnerMismatch");
}

#[test]
fn unowned_token_wallet_cannot_be_executed() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    ctx.send_remove_owner(&token, &owner).expect("remove owner");
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, LAMPORTS_PER_SOL).unwrap();

    let result = ctx.send_execute_with_owner(
        token.phygital_token,
        &owner,
        &[system_instruction::transfer(
            &wallet,
            &owner.pubkey(),
            LAMPORTS_PER_SOL,
        )],
    );
    assert_phygital_token_program_error(result, "OwnerMismatch");
}

#[test]
fn wallet_cannot_call_phygital_token() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let inner = ctx.remove_owner_ix(owner.pubkey(), token.phygital_token);

    let result = ctx.send_execute_with_owner(token.phygital_token, &owner, &[inner]);
    assert_phygital_token_program_error(result, "SelfReentrancyNotAllowed");
}

#[test]
fn token_account_is_protected_in_inner_instructions() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, LAMPORTS_PER_SOL).unwrap();

    let result = ctx.send_execute_with_owner(
        token.phygital_token,
        &owner,
        &[system_instruction::transfer(
            &wallet,
            &token.phygital_token,
            1,
        )],
    );
    assert_phygital_token_program_error(result, "ProtectedAccountPrivilege");
}

#[test]
fn wallet_must_stay_a_system_account() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let wallet = ctx.wallet_pda(token.phygital_token);
    ctx.svm.airdrop(&wallet, LAMPORTS_PER_SOL).unwrap();

    let result = ctx.send_execute_with_owner(
        token.phygital_token,
        &owner,
        &[system_instruction::assign(&wallet, &Pubkey::new_unique())],
    );
    assert_phygital_token_program_error(result, "WalletInvariantViolated");
}

#[test]
fn compact_index_outside_remaining_accounts_is_rejected() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let mut ix = ctx.execute_with_owner_ix(owner.pubkey(), token.phygital_token, &[]);
    ix.data = anchor_lang::InstructionData::data(&phygital_token::instruction::ExecuteWithOwner {
        compact_instructions: vec![phygital_token::CompactInstruction {
            program_id_index: 0,
            account_indexes: vec![],
            data: vec![],
        }],
    });

    let result = TestContext::send_instruction(&mut ctx.svm, ix, &[&owner]);
    assert_phygital_token_program_error(result, "InvalidAccountIndex");
}

#[test]
fn durable_nonce_transactions_are_rejected() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let nonce = Keypair::new();
    let create = system_instruction::create_nonce_account(
        &owner.pubkey(),
        &nonce.pubkey(),
        &owner.pubkey(),
        LAMPORTS_PER_SOL,
    );
    TestContext::send_instructions(&mut ctx.svm, &create, &[&owner, &nonce]).unwrap();

    let advance = system_instruction::advance_nonce_account(&nonce.pubkey(), &owner.pubkey());
    let execute = ctx.execute_with_owner_ix(owner.pubkey(), token.phygital_token, &[]);
    let result = TestContext::send_instructions(&mut ctx.svm, &[advance, execute], &[&owner]);
    assert_phygital_token_program_error(result, "DurableNonceNotAllowed");
}
