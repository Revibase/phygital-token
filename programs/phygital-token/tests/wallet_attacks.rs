mod common;

use anchor_lang::prelude::{Pubkey, Rent};
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::spl_token_2022::instruction::initialize_account3;
use anchor_spl::token_2022::spl_token_2022::state::Account as TokenAccountState;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use common::{
    allow, assert_phygital_token_program_error, sol_cap, token_close_ix, token_set_authority_ix,
    token_transfer_ix, AuthorityType, MintedPhygitalToken, TestContext, LAMPORTS_PER_SOL,
};
use phygital_token::{
    AccountConstraint, AccountKeyConstraint, CapArg, Comparison, DataConstraint, DataPredicate,
    InstructionRule, NumericWidth, PhygitalTokenType, PolicyAction, ProgramAccess,
    ProgramPermission,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn funded(ctx: &mut TestContext) -> Keypair {
    let keypair = Keypair::new();
    ctx.svm
        .airdrop(&keypair.pubkey(), 10 * LAMPORTS_PER_SOL)
        .unwrap();
    keypair
}

/// Tap-signed execute with extra transaction signers.
fn tap(
    ctx: &mut TestContext,
    token: &MintedPhygitalToken,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> litesvm::types::TransactionResult {
    let (secp_ix, ix) = ctx.execute_with_accessory_ixs(token, instructions);
    let payer = ctx.payer.insecure_clone();
    let mut all = vec![&payer];
    all.extend_from_slice(signers);
    TestContext::send_instructions(&mut ctx.svm, &[secp_ix, ix], &all)
}

#[test]
fn sol_parked_in_an_account_someone_else_can_close_is_spent() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) = ctx.token_with_policy(
        PhygitalTokenType::Permanent,
        vec![
            allow(anchor_lang::system_program::ID),
            sol_cap(LAMPORTS_PER_SOL / 2),
        ],
    );
    // A token account the attacker hands to the wallet but can still close.
    let attacker = funded(&mut ctx);
    let mint = ctx.create_mint();
    let parked = ctx.create_token_account(attacker.pubkey(), mint);
    for (new_authority, authority_type) in [
        (attacker.pubkey(), AuthorityType::CloseAccount),
        (wallet, AuthorityType::AccountOwner),
    ] {
        let ix = token_set_authority_ix(
            parked,
            Some(new_authority),
            authority_type,
            attacker.pubkey(),
        );
        TestContext::send_instruction(&mut ctx.svm, ix, &[&attacker]).unwrap();
    }

    // Wallet pays out while the attacker refills a token account: only free if
    // the wallet alone can close that account.
    let refill = |account: Pubkey| {
        [
            system_instruction::transfer(&wallet, &attacker.pubkey(), LAMPORTS_PER_SOL),
            system_instruction::transfer(&attacker.pubkey(), &account, LAMPORTS_PER_SOL),
        ]
    };
    let result = tap(&mut ctx, &token, &refill(parked), &[&attacker]);
    assert_phygital_token_program_error(result, "SpendLimitExceeded");

    let kept = ctx.create_token_account(wallet, mint);
    tap(&mut ctx, &token, &refill(kept), &[&attacker]).expect("value stays with the wallet");
}

#[test]
fn closing_a_wallet_token_account_to_an_outsider_spends_its_rent() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) =
        ctx.token_with_policy(PhygitalTokenType::Permanent, vec![allow(TOKEN_2022_ID)]);
    let mint = ctx.create_mint();
    let first = ctx.create_token_account(wallet, mint);
    let second = ctx.create_token_account(wallet, mint);

    let ix = token_close_ix(first, Pubkey::new_unique(), wallet);
    let result = ctx.send_execute_with_accessory(&token, &[ix]);
    assert_phygital_token_program_error(result, "SpendNotAllowed");

    let rent = ctx.lamports(&second);
    let before = ctx.lamports(&wallet);
    let ix = token_close_ix(second, wallet, wallet);
    ctx.send_execute_with_accessory(&token, &[ix])
        .expect("closing to the wallet keeps the SOL");
    assert_eq!(ctx.lamports(&wallet), before + rent);
}

#[test]
fn wallet_paid_token_account_for_the_wallet_is_not_a_spend() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) = ctx.token_with_policy(
        PhygitalTokenType::Permanent,
        vec![allow(anchor_lang::system_program::ID), allow(TOKEN_2022_ID)],
    );
    let mint = ctx.create_mint();
    let account = Keypair::new();
    let rent: Rent = ctx.svm.get_sysvar();
    let create = [
        system_instruction::create_account(
            &wallet,
            &account.pubkey(),
            rent.minimum_balance(TokenAccountState::LEN),
            TokenAccountState::LEN as u64,
            &TOKEN_2022_ID,
        ),
        initialize_account3(&TOKEN_2022_ID, &account.pubkey(), &mint, &wallet).unwrap(),
    ];

    tap(&mut ctx, &token, &create, &[&account]).expect("no SOL cap needed");
    assert_eq!(ctx.token_balance(account.pubkey()), 0);
}

#[test]
fn accessory_cannot_hand_control_of_wallet_tokens_away() {
    let mut ctx = TestContext::new();
    let (token, _owner, wallet) =
        ctx.token_with_policy(PhygitalTokenType::Permanent, vec![allow(TOKEN_2022_ID)]);
    let mint = ctx.create_mint();
    let account = ctx.create_token_account(wallet, mint);
    let attacker = Pubkey::new_unique();

    for authority_type in [AuthorityType::CloseAccount, AuthorityType::AccountOwner] {
        let ix = token_set_authority_ix(account, Some(attacker), authority_type, wallet);
        let result = ctx.send_execute_with_accessory(&token, &[ix]);
        assert_phygital_token_program_error(result, "TokenAuthorityChanged");
    }
}

/// Token-2022 `transfer_checked` data: `[12, amount: u64, decimals: u8]`.
#[test]
fn restricted_token_rule_only_allows_small_transfers_to_one_destination() {
    let mut ctx = TestContext::new();
    let mint = ctx.create_mint();
    let destination = ctx.create_token_account(Pubkey::new_unique(), mint);
    let rule = InstructionRule {
        selector: vec![12],
        data_length: Some(10),
        account_count: Some(4),
        accounts: vec![AccountConstraint {
            index: 2,
            key: AccountKeyConstraint::Address(destination),
            owner: None,
            is_signer: None,
            is_writable: None,
            data: vec![],
        }],
        arguments: vec![DataConstraint {
            offset: 1,
            predicate: DataPredicate::Unsigned {
                width: NumericWidth::U64,
                comparison: Comparison::LessThanOrEqual,
                value: 100,
            },
        }],
    };
    let (token, _owner, wallet) = ctx.token_with_policy(
        PhygitalTokenType::Permanent,
        vec![
            PolicyAction::SetProgramPermission(ProgramPermission {
                program_id: TOKEN_2022_ID,
                access: ProgramAccess::Restricted(vec![rule]),
            }),
            PolicyAction::SetMintCap(
                mint,
                CapArg {
                    cap: 1_000,
                    ..Default::default()
                },
            ),
        ],
    );
    let source = ctx.create_token_account(wallet, mint);
    let elsewhere = ctx.create_token_account(Pubkey::new_unique(), mint);
    ctx.mint_tokens(mint, source, 1_000);

    for ix in [
        token_transfer_ix(source, mint, elsewhere, wallet, 50),
        token_transfer_ix(source, mint, destination, wallet, 150),
        token_set_authority_ix(
            source,
            Some(Pubkey::new_unique()),
            AuthorityType::CloseAccount,
            wallet,
        ),
    ] {
        let result = ctx.send_execute_with_accessory(&token, &[ix]);
        assert_phygital_token_program_error(result, "InstructionNotAllowed");
    }

    let ix = token_transfer_ix(source, mint, destination, wallet, 50);
    ctx.send_execute_with_accessory(&token, &[ix])
        .expect("allowed transfer");
    assert_eq!(ctx.token_balance(destination), 50);
}
