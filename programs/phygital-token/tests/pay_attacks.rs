//! What a tap payment refuses: anything the tap did not sign, a different
//! merchant, someone else's accounts, replays, and taps made for other
//! instructions.

mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_phygital_token_program_error, assert_transaction_failed, current_slot_entry, Payment,
    TestContext, SPL_TOKEN,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[allow(clippy::result_large_err)]
fn send(
    ctx: &mut TestContext,
    signer: &Keypair,
    instructions: Vec<anchor_lang::solana_program::instruction::Instruction>,
) -> litesvm::types::TransactionResult {
    ctx.svm.airdrop(&signer.pubkey(), 1_000_000_000).ok();
    TestContext::send_instructions(&mut ctx.svm, &instructions, &[signer])
}

#[test]
fn every_signed_field_is_bound() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let signed = setup.payment(5);
    let other_destination = ctx.create_token_account(setup.payee, setup.mint);
    let other_mint = ctx.create_mint(SPL_TOKEN);
    for tampered in [
        Payment {
            amount: 6,
            ..signed.clone()
        },
        Payment {
            destination: other_destination,
            ..signed.clone()
        },
        Payment {
            reference: Pubkey::new_unique(),
            ..signed.clone()
        },
        Payment {
            mint: other_mint,
            ..signed.clone()
        },
    ] {
        let instructions = ctx.pay_instructions(&setup.token.passkey, &signed, &tampered);
        let merchant = setup.merchant.insecure_clone();
        assert_transaction_failed(send(&mut ctx, &merchant, instructions));
    }
    assert_eq!(ctx.token_balance(setup.destination), 0);
    assert_eq!(ctx.token_balance(other_destination), 0);
}

#[test]
fn the_tap_names_the_merchant_that_must_sign() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let signed = setup.payment(5);

    // Another registered merchant (sharing the payee) can't submit this tap.
    let rival = Keypair::new();
    ctx.register_merchant(&setup.registrar, &rival, vec![setup.payee])
        .unwrap();
    let as_rival = Payment {
        merchant: rival.pubkey(),
        ..signed.clone()
    };
    let instructions = ctx.pay_instructions(&setup.token.passkey, &signed, &as_rival);
    assert_phygital_token_program_error(
        send(&mut ctx, &rival, instructions),
        "ChallengeHashMismatch",
    );

    // Without the merchant's signature the transaction can't be built.
    let mut instructions = ctx.pay_instructions(&setup.token.passkey, &signed, &signed);
    for meta in &mut instructions[1].accounts {
        if meta.pubkey == setup.merchant.pubkey() {
            meta.is_signer = false;
        }
    }
    let relayer = Keypair::new();
    assert_transaction_failed(send(&mut ctx, &relayer, instructions));
}

#[test]
fn another_merchants_record_cannot_vouch_for_the_signer() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let impostor = Keypair::new();
    let payment = Payment {
        merchant: impostor.pubkey(),
        ..setup.payment(5)
    };
    let mut instructions = ctx.pay_instructions(&setup.token.passkey, &payment, &payment);
    // Point merchant_record at the real merchant's entry.
    let record = ctx.merchant_pda(impostor.pubkey());
    for meta in &mut instructions[1].accounts {
        if meta.pubkey == record {
            meta.pubkey = ctx.merchant_pda(setup.merchant.pubkey());
        }
    }
    assert_transaction_failed(send(&mut ctx, &impostor, instructions));
}

#[test]
fn only_the_owners_delegated_accounts_can_be_debited() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);

    // A victim delegated to their own delegate PDA, which this accessory's
    // owner doesn't control.
    let victim = Keypair::new();
    ctx.svm.airdrop(&victim.pubkey(), 1_000_000_000).unwrap();
    let victim_account = ctx.create_token_account(victim.pubkey(), setup.mint);
    ctx.mint_tokens(setup.mint, victim_account, 100);
    let victim_delegate = ctx.delegate_pda(victim.pubkey());
    ctx.approve(victim_account, setup.mint, victim_delegate, &victim, 100)
        .unwrap();
    let payment = Payment {
        source: victim_account,
        ..setup.payment(5)
    };
    assert_phygital_token_program_error(ctx.pay(&setup, &payment), "InvalidTokenAccount");

    // Even an account of someone else delegated to *this* owner's PDA.
    let owner_delegate = ctx.delegate_pda(setup.owner.pubkey());
    ctx.approve(victim_account, setup.mint, owner_delegate, &victim, 100)
        .unwrap();
    assert_phygital_token_program_error(ctx.pay(&setup, &payment), "InvalidTokenAccount");
    assert_eq!(ctx.token_balance(victim_account), 100);
}

#[test]
fn an_assertion_pays_once() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let payment = setup.payment(5);
    let instructions = ctx.pay_instructions(&setup.token.passkey, &payment, &payment);
    let merchant = setup.merchant.insecure_clone();
    send(&mut ctx, &merchant, instructions.clone()).unwrap();
    assert_phygital_token_program_error(send(&mut ctx, &merchant, instructions), "StaleSignCount");
    assert_eq!(ctx.token_balance(setup.destination), 5);
}

#[test]
fn a_set_owner_tap_cannot_pay_and_a_pay_tap_cannot_claim() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let payment = setup.payment(5);
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let sign_count = ctx.next_sign_count(setup.token.phygital_token);

    // A set_owner tap submitted as a payment.
    let (secp_ix, args) = setup.token.passkey.secp256r1_verify_instruction(
        setup.token.phygital_token,
        slot_hash,
        sign_count,
    );
    let pay_ix = ctx.pay_ix(&payment, args, slot_number);
    let merchant = setup.merchant.insecure_clone();
    assert_phygital_token_program_error(
        send(&mut ctx, &merchant, vec![secp_ix, pay_ix]),
        "ChallengeHashMismatch",
    );

    // A payment tap submitted to set_owner.
    let instructions = ctx.pay_instructions(&setup.token.passkey, &payment, &payment);
    let args = <phygital_token::instruction::PayWithAccessory as anchor_lang::AnchorDeserialize>::deserialize(
        &mut &instructions[1].data[8..],
    )
    .unwrap()
    .secp256r1_verify_args;
    let thief = Keypair::new();
    let set_owner = ctx.set_owner_ix(
        thief.pubkey(),
        setup.token.phygital_token,
        args,
        slot_number,
    );
    assert_phygital_token_program_error(
        send(&mut ctx, &thief, vec![instructions[0].clone(), set_owner]),
        "ChallengeHashMismatch",
    );
    assert_eq!(
        ctx.phygital_token_owner(setup.token.phygital_token),
        setup.owner.pubkey()
    );
}

#[test]
fn a_verify_tap_cannot_pay() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let payment = setup.payment(5);
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    // An integrator asks for a `verify` tap whose message_hash is this payment's challenge.
    let challenge = phygital_token::build_pay_challenge(
        &slot_hash,
        &payment.merchant,
        &payment.mint,
        &payment.destination,
        payment.amount,
        &payment.reference,
    );
    let sign_count = ctx.next_sign_count(setup.token.phygital_token);
    let (secp_ix, args) = setup
        .token
        .passkey
        .verify_secp256r1_instruction(challenge, sign_count);
    let pay_ix = ctx.pay_ix(&payment, args, slot_number);
    let merchant = setup.merchant.insecure_clone();
    assert_phygital_token_program_error(
        send(&mut ctx, &merchant, vec![secp_ix, pay_ix]),
        "ChallengeHashMismatch",
    );
}

#[test]
fn another_accessorys_policy_cannot_be_substituted() {
    let mut ctx = TestContext::new();
    let setup = ctx.pay_setup(SPL_TOKEN);
    let other = ctx.pay_setup(SPL_TOKEN);
    let payment = setup.payment(5);
    let mut instructions = ctx.pay_instructions(&setup.token.passkey, &payment, &payment);
    let mine = ctx.spend_policy_pda(setup.token.phygital_token);
    for meta in &mut instructions[1].accounts {
        if meta.pubkey == mine {
            meta.pubkey = ctx.spend_policy_pda(other.token.phygital_token);
        }
    }
    let merchant = setup.merchant.insecure_clone();
    assert_transaction_failed(send(&mut ctx, &merchant, instructions));
}
