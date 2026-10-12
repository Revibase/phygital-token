mod common;

use anchor_lang::prelude::{Pubkey, Rent};
use common::{allow, assert_phygital_token_program_error, TestContext, LAMPORTS_PER_SOL};
use phygital_token::{
    CapArg, InstructionRule, PhygitalTokenType, PolicyAction, ProgramAccess, ProgramPermission,
    WSOL_MINT,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn cap(cap: u64) -> CapArg {
    CapArg {
        cap,
        ..Default::default()
    }
}

fn mint_cap(mint: Pubkey, amount: u64) -> PolicyAction {
    PolicyAction::SetMintCap(mint, cap(amount))
}

fn with_paymaster(ctx: &mut TestContext) -> (common::MintedPhygitalToken, Keypair, Keypair) {
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let paymaster = Keypair::new();
    ctx.svm
        .airdrop(&paymaster.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();
    (token, owner, paymaster)
}

#[test]
fn first_update_creates_an_empty_policy_paid_by_any_payer() {
    let mut ctx = TestContext::new();
    let (token, owner, paymaster) = with_paymaster(&mut ctx);

    let ix = ctx.update_policy_ix(
        owner.pubkey(),
        paymaster.pubkey(),
        token.phygital_token,
        vec![],
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&paymaster, &owner]).expect("create");

    let policy = ctx.policy(token.phygital_token).expect("policy");
    assert_eq!(policy.wallet, ctx.wallet_pda(token.phygital_token));
    assert!(policy.sol_cap.is_none());
    assert!(policy.mint_caps.is_empty());
    assert!(policy.program_permissions.is_empty());
}

#[test]
fn owner_adds_replaces_and_removes_entries_incrementally() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let [program_a, program_b, mint_a, mint_b] = core::array::from_fn(|_| Pubkey::new_unique());

    ctx.send_update_policy(
        token.phygital_token,
        &owner,
        vec![allow(program_a), mint_cap(mint_a, 10)],
    )
    .expect("first update");
    ctx.send_update_policy(
        token.phygital_token,
        &owner,
        vec![
            allow(program_b),
            mint_cap(mint_b, 20),
            mint_cap(mint_a, 15),
            PolicyAction::SetSolCap(Some(cap(5))),
        ],
    )
    .expect("second update");

    let policy = ctx.policy(token.phygital_token).unwrap();
    let programs: Vec<_> = policy
        .program_permissions
        .iter()
        .map(|p| p.program_id)
        .collect();
    assert_eq!(programs, vec![program_a, program_b]);
    let caps: Vec<_> = policy
        .mint_caps
        .iter()
        .map(|m| (m.mint, m.cap.cap))
        .collect();
    assert_eq!(caps, vec![(mint_a, 15), (mint_b, 20)]);
    assert_eq!(policy.sol_cap.unwrap().cap, 5);

    ctx.send_update_policy(
        token.phygital_token,
        &owner,
        vec![
            PolicyAction::RemoveProgramPermission(program_a),
            PolicyAction::RemoveMintCap(mint_b),
            PolicyAction::SetSolCap(None),
        ],
    )
    .expect("removals");

    let policy = ctx.policy(token.phygital_token).unwrap();
    let programs: Vec<_> = policy
        .program_permissions
        .iter()
        .map(|p| p.program_id)
        .collect();
    assert_eq!(programs, vec![program_b]);
    let mints: Vec<_> = policy.mint_caps.iter().map(|m| m.mint).collect();
    assert_eq!(mints, vec![mint_a]);
    assert!(policy.sol_cap.is_none());
}

#[test]
fn setting_a_program_twice_replaces_it() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let program = Pubkey::new_unique();
    ctx.send_update_policy(token.phygital_token, &owner, vec![allow(program)])
        .expect("first set");
    let PolicyAction::SetProgramPermission(restricted) = restricted(&[&[2, 0, 0, 0]]) else {
        unreachable!()
    };
    let narrowed = ProgramPermission {
        program_id: program,
        ..restricted
    };
    ctx.send_update_policy(
        token.phygital_token,
        &owner,
        vec![
            allow(program),
            PolicyAction::SetProgramPermission(narrowed.clone()),
        ],
    )
    .expect("set again");

    let policy = ctx.policy(token.phygital_token).unwrap();
    assert_eq!(policy.program_permissions, vec![narrowed]);
}

#[test]
fn removing_a_missing_entry_fails() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    for action in [
        PolicyAction::RemoveProgramPermission(Pubkey::new_unique()),
        PolicyAction::RemoveMintCap(Pubkey::new_unique()),
    ] {
        let result = ctx.send_update_policy(token.phygital_token, &owner, vec![action]);
        assert_phygital_token_program_error(result, "InvalidPolicyArgs");
    }
}

#[test]
fn policy_validation_is_enforced() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);

    let many_programs = (0..17).map(|_| allow(Pubkey::new_unique())).collect();
    ctx.send_update_policy(token.phygital_token, &owner, many_programs)
        .expect("no program-count limit");
    for _ in 0..2 {
        let mints = (0..9).map(|_| mint_cap(Pubkey::new_unique(), 1)).collect();
        ctx.send_update_policy(token.phygital_token, &owner, mints)
            .expect("no mint-cap limit");
    }
    let policy = ctx.policy(token.phygital_token).unwrap();
    assert_eq!(policy.program_permissions.len(), 17);
    assert_eq!(policy.mint_caps.len(), 18);

    for action in [
        PolicyAction::SetProgramPermission(ProgramPermission {
            program_id: Pubkey::new_unique(),
            access: ProgramAccess::Restricted(vec![]),
        }),
        mint_cap(WSOL_MINT, 1),
        mint_cap(Pubkey::new_unique(), 0),
        allow(phygital_token::ID),
        // Two rules that can match the same instruction.
        restricted(&[&[2, 0, 0, 0], &[2, 0, 0, 0]]),
        restricted(&[&[2], &[2, 0, 0, 0]]),
    ] {
        let result = ctx.send_update_policy(token.phygital_token, &owner, vec![action]);
        assert_phygital_token_program_error(result, "InvalidPolicyArgs");
    }
}

fn restricted(selectors: &[&[u8]]) -> PolicyAction {
    PolicyAction::SetProgramPermission(ProgramPermission {
        program_id: Pubkey::new_unique(),
        access: ProgramAccess::Restricted(
            selectors
                .iter()
                .map(|selector| InstructionRule {
                    selector: selector.to_vec(),
                    data_length: None,
                    account_count: None,
                    accounts: vec![],
                    arguments: vec![],
                })
                .collect(),
        ),
    })
}

#[test]
fn unchanged_cap_keeps_its_usage() {
    let mut ctx = TestContext::new();
    let (token, owner) = ctx.owned_token(PhygitalTokenType::Controlled);
    let mint = Pubkey::new_unique();
    ctx.send_update_policy(token.phygital_token, &owner, vec![mint_cap(mint, 100)])
        .unwrap();

    // Simulate usage by rewriting `remaining`.
    let address = ctx.policy_pda(token.phygital_token);
    let mut policy = ctx.policy(token.phygital_token).unwrap();
    policy.mint_caps[0].cap.remaining = 40;
    let mut account = ctx.svm.get_account(&address).unwrap();
    account.data.clear();
    anchor_lang::AccountSerialize::try_serialize(&policy, &mut account.data).unwrap();
    ctx.svm.set_account(address, account).unwrap();

    let remaining = |ctx: &TestContext| {
        ctx.policy(token.phygital_token).unwrap().mint_caps[0]
            .cap
            .remaining
    };
    ctx.send_update_policy(token.phygital_token, &owner, vec![mint_cap(mint, 100)])
        .unwrap();
    assert_eq!(remaining(&ctx), 40);
    ctx.send_update_policy(token.phygital_token, &owner, vec![mint_cap(mint, 200)])
        .unwrap();
    assert_eq!(remaining(&ctx), 200);
}

#[test]
fn policy_grows_from_payer_and_keeps_freed_rent_until_close() {
    let mut ctx = TestContext::new();
    let (token, owner, paymaster) = with_paymaster(&mut ctx);
    let address = ctx.policy_pda(token.phygital_token);
    let rent: Rent = ctx.svm.get_sysvar();

    let ix = ctx.update_policy_ix(
        owner.pubkey(),
        paymaster.pubkey(),
        token.phygital_token,
        vec![],
    );
    TestContext::send_instruction(&mut ctx.svm, ix, &[&paymaster, &owner]).unwrap();
    let small = ctx.svm.get_account(&address).unwrap();
    assert_eq!(small.lamports, rent.minimum_balance(small.data.len()));

    let program_ids: [Pubkey; 4] = core::array::from_fn(|_| Pubkey::new_unique());
    ctx.send_update_policy(
        token.phygital_token,
        &owner,
        program_ids.map(allow).to_vec(),
    )
    .unwrap();
    let big = ctx.svm.get_account(&address).unwrap();
    assert_eq!(big.data.len(), small.data.len() + 4 * 33);
    assert_eq!(big.lamports, rent.minimum_balance(big.data.len()));

    let removals = program_ids
        .map(PolicyAction::RemoveProgramPermission)
        .to_vec();
    ctx.send_update_policy(token.phygital_token, &owner, removals)
        .unwrap();
    let shrunk = ctx.svm.get_account(&address).unwrap();
    assert_eq!(shrunk.data.len(), small.data.len());
    assert_eq!(shrunk.lamports, big.lamports);

    let wallet = ctx.wallet_pda(token.phygital_token);
    let wallet_before = ctx.lamports(&wallet);
    let ix = ctx.close_policy_ix(owner.pubkey(), token.phygital_token, wallet);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&owner]).unwrap();
    assert_eq!(ctx.lamports(&wallet), wallet_before + big.lamports);
}

#[test]
fn only_the_owner_updates_the_policy() {
    let mut ctx = TestContext::new();
    let (token, _owner) = ctx.owned_token(PhygitalTokenType::Permanent);
    let attacker = Keypair::new();
    ctx.svm
        .airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let result = ctx.send_update_policy(
        token.phygital_token,
        &attacker,
        vec![allow(anchor_lang::system_program::ID)],
    );
    assert_phygital_token_program_error(result, "OwnerMismatch");
}
