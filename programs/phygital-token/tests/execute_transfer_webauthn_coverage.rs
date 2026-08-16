mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_token_program_error, current_slot_entry, TestContext, TestPasskey, LAMPORTS_PER_SOL,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// `signed_message_index` past the number of signatures in the secp256r1
/// instruction must be rejected (covers `SignatureIndexOutOfBounds`).
#[test]
fn execute_transfer_rejects_signature_index_out_of_bounds() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_verify_instruction(asset.asset, slot_hash, 1);
    verify_args.signed_message_index = 1;

    let transfer_ix =
        ctx.execute_transfer_ix(recipient.pubkey(), asset.asset, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "SignatureIndexOutOfBounds");
}

/// Malformed `client_data_json` must be rejected before hash comparison.
#[test]
fn execute_transfer_rejects_unparseable_client_data() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_verify_instruction(asset.asset, slot_hash, 1);
    verify_args.client_data_json = b"not-json".to_vec();

    let transfer_ix =
        ctx.execute_transfer_ix(recipient.pubkey(), asset.asset, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "UnableToParseClientData");
}

/// `client_data_json` must hash to the value embedded in the secp256r1 instruction.
#[test]
fn execute_transfer_rejects_client_data_hash_mismatch() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_verify_instruction(asset.asset, slot_hash, 1);
    verify_args.client_data_json.push(b' ');

    let transfer_ix =
        ctx.execute_transfer_ix(recipient.pubkey(), asset.asset, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "ClientDataHashMismatch");
}

/// Authenticator data without the WebAuthn UP flag must be rejected.
#[test]
fn execute_transfer_rejects_missing_user_presence() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) =
        passkey.secp256r1_verify_instruction_with_auth_flags(asset.asset, slot_hash, 1, 0x00);

    let transfer_ix =
        ctx.execute_transfer_ix(recipient.pubkey(), asset.asset, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "UserPresenceNotVerified");
}

/// Documents the intended bearer/claim semantics: the passkey signs over the
/// asset PDA only — the recipient is NOT part of the signed challenge — so any
/// recipient that submits the transaction can claim the asset. This is the
/// on-chain counterpart to the front-running property documented on
/// `build_transfer_challenge`. If recipient-binding is ever added, this test
/// should be inverted into a rejection test.
#[test]
fn execute_transfer_bearer_signature_claimable_by_any_recipient() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    // The signature is built without reference to any recipient, so a recipient
    // other than the (conceptually) intended one can claim the asset.
    let other_recipient = Keypair::new();

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(asset.asset, slot_hash, 1);

    let transfer_ix = ctx.execute_transfer_ix(
        other_recipient.pubkey(),
        asset.asset,
        verify_args,
        slot_number,
    );
    ctx.svm
        .airdrop(&other_recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&other_recipient])
        .expect("bearer signature is claimable by any submitting recipient");

    assert_ne!(ctx.asset_owner(asset.asset), Pubkey::default());
    assert_eq!(ctx.asset_owner(asset.asset), other_recipient.pubkey());
}
