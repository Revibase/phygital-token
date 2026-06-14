mod common;

use anchor_lang::AccountDeserialize;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use common::{
    assert_token_program_error, current_slot_entry, TestContext, TestPasskey, LAMPORTS_PER_SOL,
};
use phygital_nfts::state::CardInstance;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// `signed_message_index` past the number of signatures in the secp256r1
/// instruction must be rejected (covers `SignatureIndexOutOfBounds`).
#[test]
fn execute_transfer_rejects_signature_index_out_of_bounds() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) = passkey.secp256r1_verify_instruction(
        TOKEN_2022_ID,
        card.card_instance,
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );
    // The secp256r1 instruction carries exactly one signature (index 0).
    verify_args.signed_message_index = 1;

    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        card.card_instance,
        card.mint,
        verify_args,
    );
    ctx.svm.airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL).ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "SignatureIndexOutOfBounds");
}

/// An empty `origin` is rejected before any hash comparison (covers the
/// `MaxLengthExceeded` guard at the top of `verify_webauthn`).
#[test]
fn execute_transfer_rejects_empty_origin() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) = passkey.secp256r1_verify_instruction(
        TOKEN_2022_ID,
        card.card_instance,
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );
    verify_args.origin = String::new();

    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        card.card_instance,
        card.mint,
        verify_args,
    );
    ctx.svm.airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL).ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "MaxLengthExceeded");
}

/// An `origin` longer than `MAX_ORIGIN_LEN` is rejected (covers the upper bound
/// of the `verify_webauthn` length guard).
#[test]
fn execute_transfer_rejects_overlong_origin() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) = passkey.secp256r1_verify_instruction(
        TOKEN_2022_ID,
        card.card_instance,
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );
    verify_args.origin = "a".repeat(257);

    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        card.card_instance,
        card.mint,
        verify_args,
    );
    ctx.svm.airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL).ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "MaxLengthExceeded");
}

/// Documents the intended bearer/claim semantics: the passkey signs over
/// `(card_instance, sender)` only — the recipient is NOT part of the signed
/// challenge — so any recipient that submits the transaction can claim the card.
/// This is the on-chain counterpart to the front-running property documented on
/// `build_transfer_message_hash`. If recipient-binding is ever added, this test
/// should be inverted into a rejection test.
#[test]
fn execute_transfer_bearer_signature_claimable_by_any_recipient() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);

    // The signature is built without reference to any recipient, so a recipient
    // other than the (conceptually) intended one can claim the card.
    let other_recipient = Keypair::new();

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(
        TOKEN_2022_ID,
        card.card_instance,
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );

    // A different recipient than the (conceptually) intended one claims the card.
    let transfer_ix = ctx.execute_transfer_ix(
        other_recipient.pubkey(),
        ctx.program_authority(),
        card.card_instance,
        card.mint,
        verify_args,
    );
    ctx.svm
        .airdrop(&other_recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&other_recipient])
        .expect("bearer signature is claimable by any submitting recipient");

    assert_eq!(ctx.token_balance(other_recipient.pubkey(), card.mint), 1);

    let card_account = ctx
        .svm
        .get_account(&card.card_instance)
        .expect("card instance account");
    let instance =
        CardInstance::try_deserialize(&mut card_account.data.as_ref()).expect("deserialize");
    assert_eq!(instance.owner, other_recipient.pubkey());
}
