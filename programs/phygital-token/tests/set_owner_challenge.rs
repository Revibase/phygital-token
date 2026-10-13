mod common;

use anchor_lang::prelude::Pubkey;
use phygital_token::build_set_owner_challenge;
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn transfer_challenge_is_deterministic() {
    let phygital_token = Keypair::new().pubkey();
    let slot_hash = [7u8; 32];

    let hash = build_set_owner_challenge(&phygital_token, slot_hash, &Pubkey::default());
    let hash_again = build_set_owner_challenge(&phygital_token, slot_hash, &Pubkey::default());

    assert_eq!(hash, hash_again);
}

#[test]
fn transfer_challenge_changes_when_token_changes() {
    let phygital_token_a = Keypair::new().pubkey();
    let phygital_token_b = Keypair::new().pubkey();
    let slot_hash = [7u8; 32];

    let hash_a = build_set_owner_challenge(&phygital_token_a, slot_hash, &Pubkey::default());
    let hash_b = build_set_owner_challenge(&phygital_token_b, slot_hash, &Pubkey::default());

    assert_ne!(hash_a, hash_b);
}

#[test]
fn transfer_challenge_changes_when_slot_hash_changes() {
    let phygital_token = Keypair::new().pubkey();

    let hash_a = build_set_owner_challenge(&phygital_token, [1u8; 32], &Pubkey::default());
    let hash_b = build_set_owner_challenge(&phygital_token, [2u8; 32], &Pubkey::default());

    assert_ne!(hash_a, hash_b);
}

#[test]
fn set_owner_challenge_golden_vector() {
    let phygital_token = Pubkey::new_from_array([2u8; 32]);
    let slot_hash = [3u8; 32];
    let recipient = Pubkey::new_from_array([4u8; 32]);

    let mut preimage = Vec::new();
    preimage.extend_from_slice(b"transfer");
    preimage.extend_from_slice(phygital_token.as_ref());
    preimage.extend_from_slice(&slot_hash);
    preimage.extend_from_slice(recipient.as_ref());
    let expected: [u8; 32] = Sha256::digest(&preimage).into();

    let hash = build_set_owner_challenge(&phygital_token, slot_hash, &recipient);
    assert_eq!(hash, expected);
    let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
    // Shared with the SDK's buildTransferChallenge test.
    println!("set_owner challenge vector: {hex}");
}

#[test]
fn set_owner_challenge_binds_the_recipient() {
    let phygital_token = Keypair::new().pubkey();
    let slot_hash = [7u8; 32];
    let a = build_set_owner_challenge(&phygital_token, slot_hash, &Keypair::new().pubkey());
    let b = build_set_owner_challenge(&phygital_token, slot_hash, &Keypair::new().pubkey());
    assert_ne!(a, b);
}

/// A tap made for one recipient cannot be submitted by anyone else.
#[test]
fn set_owner_rejects_a_tap_made_for_another_recipient() {
    let mut ctx = common::TestContext::new();
    let passkey = common::TestPasskey::generate();
    let token = ctx.init_phygital_token(&passkey);
    let intended = Keypair::new();
    let front_runner = Keypair::new();
    ctx.svm
        .airdrop(&front_runner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();
    let (slot_number, slot_hash) = common::current_slot_entry(&ctx.svm);
    let sign_count = ctx.next_sign_count(token.phygital_token);

    let (secp_ix, args) = passkey.secp256r1_verify_instruction(
        token.phygital_token,
        intended.pubkey(),
        slot_hash,
        sign_count,
    );
    let stolen = ctx.set_owner_ix(
        front_runner.pubkey(),
        token.phygital_token,
        args,
        slot_number,
    );
    let result =
        common::TestContext::send_instructions(&mut ctx.svm, &[secp_ix, stolen], &[&front_runner]);
    common::assert_phygital_token_program_error(result, "ChallengeHashMismatch");
    assert_eq!(
        ctx.phygital_token_owner(token.phygital_token),
        Pubkey::default()
    );
}
