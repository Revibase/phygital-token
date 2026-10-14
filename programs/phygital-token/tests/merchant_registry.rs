//! The merchant registry: only the registrar writes it.

mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_phygital_token_program_error, assert_transaction_failed, TestContext};
use phygital_token::{MerchantArgs, MerchantStatus};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn args(payees: Vec<Pubkey>) -> MerchantArgs {
    MerchantArgs {
        payees,
        domain: "cafe.example".into(),
        name: "Cafe".into(),
    }
}

#[test]
fn only_the_admin_sets_a_registrar_with_a_fresh_key() {
    let mut ctx = TestContext::new();
    let outsider = Keypair::new();
    ctx.svm.airdrop(&outsider.pubkey(), 1_000_000_000).unwrap();
    let ix = ctx.set_registrar_ix(outsider.pubkey(), Pubkey::new_unique());
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&outsider]),
        "UnauthorizedAdmin",
    );
    let admin = ctx.admin.insecure_clone();
    for taken in [ctx.admin.pubkey(), ctx.issuer.pubkey(), Pubkey::default()] {
        let ix = ctx.set_registrar_ix(admin.pubkey(), taken);
        assert_transaction_failed(TestContext::send_instruction(&mut ctx.svm, ix, &[&admin]));
    }
    let first = ctx.install_registrar();
    let second = ctx.install_registrar();
    assert_ne!(first.pubkey(), second.pubkey(), "the admin can replace it");
}

#[test]
fn registering_needs_the_registrar_and_the_merchant() {
    let mut ctx = TestContext::new();
    let registrar = ctx.install_registrar();
    let merchant = Keypair::new();
    let payee = Pubkey::new_unique();
    ctx.register_merchant(&registrar, &merchant, vec![payee])
        .unwrap();
    let record = ctx.merchant(merchant.pubkey()).unwrap();
    assert_eq!(record.payees, vec![payee]);
    assert_eq!(record.status, MerchantStatus::Active);
    assert_eq!(record.domain, "cafe.example");

    let impostor = Keypair::new();
    ctx.svm.airdrop(&impostor.pubkey(), 1_000_000_000).unwrap();
    let other = Keypair::new();
    let ix = ctx.register_merchant_ix(
        impostor.pubkey(),
        other.pubkey(),
        impostor.pubkey(),
        args(vec![payee]),
    );
    assert_phygital_token_program_error(
        TestContext::send_instruction(&mut ctx.svm, ix, &[&impostor, &other]),
        "UnauthorizedRegistrar",
    );

    // The merchant must sign.
    let mut ix = ctx.register_merchant_ix(
        registrar.pubkey(),
        other.pubkey(),
        registrar.pubkey(),
        args(vec![payee]),
    );
    ix.accounts[1].is_signer = false;
    assert_transaction_failed(TestContext::send_instruction(
        &mut ctx.svm,
        ix,
        &[&registrar],
    ));
}

#[test]
fn invalid_registrations_are_refused() {
    let mut ctx = TestContext::new();
    let registrar = ctx.install_registrar();
    for bad in [
        args(vec![]),
        args(vec![Pubkey::default()]),
        MerchantArgs {
            domain: "Cafe.Example".into(),
            ..args(vec![Pubkey::new_unique()])
        },
        MerchantArgs {
            name: String::new(),
            ..args(vec![Pubkey::new_unique()])
        },
    ] {
        let merchant = Keypair::new();
        let ix = ctx.register_merchant_ix(
            registrar.pubkey(),
            merchant.pubkey(),
            registrar.pubkey(),
            bad,
        );
        assert_phygital_token_program_error(
            TestContext::send_instruction(&mut ctx.svm, ix, &[&registrar, &merchant]),
            "InvalidMerchantArgs",
        );
    }
}

#[test]
fn the_registrar_updates_suspends_and_closes() {
    let mut ctx = TestContext::new();
    let registrar = ctx.install_registrar();
    let merchant = Keypair::new();
    ctx.register_merchant(&registrar, &merchant, vec![Pubkey::new_unique()])
        .unwrap();

    let payees = vec![Pubkey::new_unique(), Pubkey::new_unique()];
    let ix = ctx.update_merchant_ix(registrar.pubkey(), merchant.pubkey(), args(payees.clone()));
    TestContext::send_instruction(&mut ctx.svm, ix, &[&registrar]).unwrap();
    assert_eq!(ctx.merchant(merchant.pubkey()).unwrap().payees, payees);

    ctx.set_merchant_status(&registrar, merchant.pubkey(), MerchantStatus::Suspended)
        .unwrap();
    assert_eq!(
        ctx.merchant(merchant.pubkey()).unwrap().status,
        MerchantStatus::Suspended
    );

    let outsider = Keypair::new();
    ctx.svm.airdrop(&outsider.pubkey(), 1_000_000_000).unwrap();
    assert_phygital_token_program_error(
        ctx.set_merchant_status(&outsider, merchant.pubkey(), MerchantStatus::Active),
        "UnauthorizedRegistrar",
    );

    let rent = ctx.lamports(ctx.merchant_pda(merchant.pubkey()));
    ctx.close_merchant(&registrar, merchant.pubkey()).unwrap();
    assert!(ctx.merchant(merchant.pubkey()).is_none());
    assert_eq!(ctx.lamports(merchant.pubkey()), rent);
}
