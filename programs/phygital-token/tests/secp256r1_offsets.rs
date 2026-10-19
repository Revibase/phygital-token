//! The secp256r1 precompile verifies each signature over the key and message
//! found in whichever instruction its offsets name, but the program reads the
//! key and message from the precompile instruction's own data. These tests pin
//! that every offsets entry must name the precompile instruction itself, and
//! that a later entry is read from its own position in the table.
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use common::{assert_phygital_token_program_error, current_slot_entry, TestContext, TestPasskey};
use phygital_token::{
    build_set_owner_challenge, Secp256r1VerifyArgs, SIGNATURE_OFFSETS_SERIALIZED_SIZE,
    SIGNATURE_OFFSETS_START,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

const OTHER_CHALLENGE: [u8; 32] = [10u8; 32];

// Byte ranges of the first offsets entry in a test precompile instruction.
const SIGNATURE_INSTRUCTION_INDEX: core::ops::Range<usize> = 4..6;
const PUBLIC_KEY_INSTRUCTION_INDEX: core::ops::Range<usize> = 8..10;
const MESSAGE_INSTRUCTION_INDEX: core::ops::Range<usize> = 14..16;
// Where the test builder puts the key, signature and message after one entry.
const PUBLIC_KEY: core::ops::Range<usize> = 16..49;
const SIGNATURE: core::ops::Range<usize> = 49..113;
const MESSAGE_START: usize = 113;

fn point_at(ix: &mut Instruction, field: core::ops::Range<usize>, instruction: u16) {
    ix.data[field].copy_from_slice(&instruction.to_le_bytes());
}

/// A `set_owner` claim of `token` by a fresh, funded recipient.
struct Claim {
    token: Pubkey,
    recipient: Keypair,
    slot_number: u64,
    challenge: [u8; 32],
    sign_count: u32,
}

impl Claim {
    fn new(ctx: &mut TestContext, token: Pubkey) -> Self {
        let recipient = Keypair::new();
        ctx.svm.airdrop(&recipient.pubkey(), 1_000_000_000).unwrap();
        let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
        let challenge = build_set_owner_challenge(&token, &recipient.pubkey(), slot_hash);
        Self {
            token,
            challenge,
            recipient,
            slot_number,
            sign_count: ctx.next_sign_count(token),
        }
    }

    #[allow(clippy::result_large_err)]
    fn send(
        &self,
        ctx: &mut TestContext,
        precompiles: Vec<Instruction>,
        args: Secp256r1VerifyArgs,
    ) -> litesvm::types::TransactionResult {
        let set_owner =
            ctx.set_owner_ix(self.recipient.pubkey(), self.token, args, self.slot_number);
        let mut instructions = precompiles;
        instructions.push(set_owner);
        TestContext::send_instructions(&mut ctx.svm, &instructions, &[&self.recipient])
    }
}

/// The attacker signs with their own key in instruction 0; instruction 1 sends
/// the precompile there for the key and keeps the victim's key in its own data.
/// Accepted, this would hand the attacker any Bearer token.
#[test]
fn set_owner_rejects_a_public_key_read_from_another_instruction() {
    let mut ctx = TestContext::new();
    let victim = TestPasskey::generate();
    let token = ctx.init_phygital_token(&victim);
    let attacker = TestPasskey::generate();
    let claim = Claim::new(&mut ctx, token.phygital_token);

    let (signed_by_attacker, args) =
        attacker.secp256r1_instruction_for_challenge(claim.challenge, claim.sign_count);
    let mut forged = signed_by_attacker.clone();
    point_at(&mut forged, SIGNATURE_INSTRUCTION_INDEX, 0);
    point_at(&mut forged, PUBLIC_KEY_INSTRUCTION_INDEX, 0);
    point_at(&mut forged, MESSAGE_INSTRUCTION_INDEX, 0);
    forged.data[PUBLIC_KEY].copy_from_slice(&victim.compressed_pubkey);

    let result = claim.send(&mut ctx, vec![signed_by_attacker, forged], args);
    assert_phygital_token_program_error(result, "InvalidSignatureOffsets");
    assert_eq!(
        ctx.phygital_token_owner(token.phygital_token),
        Pubkey::default()
    );
    assert_eq!(ctx.last_sign_count(token.phygital_token), 0);
}

/// A genuine earlier signature by the victim (instruction 0) must not vouch for
/// a different message placed in the precompile instruction's own data.
#[test]
fn set_owner_rejects_a_message_read_from_another_instruction() {
    let mut ctx = TestContext::new();
    let victim = TestPasskey::generate();
    let token = ctx.init_phygital_token(&victim);
    let claim = Claim::new(&mut ctx, token.phygital_token);

    let (old_signature, _) =
        victim.secp256r1_instruction_for_challenge(OTHER_CHALLENGE, claim.sign_count);
    // Only the unsigned message bytes of this one are used.
    let (mut forged, args) =
        victim.secp256r1_instruction_for_challenge(claim.challenge, claim.sign_count);
    point_at(&mut forged, SIGNATURE_INSTRUCTION_INDEX, 0);
    point_at(&mut forged, MESSAGE_INSTRUCTION_INDEX, 0);

    let result = claim.send(&mut ctx, vec![old_signature, forged], args);
    assert_phygital_token_program_error(result, "InvalidSignatureOffsets");
}

#[test]
fn set_owner_rejects_a_signature_read_from_another_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_phygital_token(&passkey);
    let claim = Claim::new(&mut ctx, token.phygital_token);

    let (genuine, args) =
        passkey.secp256r1_instruction_for_challenge(claim.challenge, claim.sign_count);
    let mut pointing = genuine.clone();
    point_at(&mut pointing, SIGNATURE_INSTRUCTION_INDEX, 0);

    let result = claim.send(&mut ctx, vec![genuine, pointing], args);
    assert_phygital_token_program_error(result, "InvalidSignatureOffsets");
}

/// The precompile accepts at most eight signatures; the last entry is read from
/// its own position in the offsets table.
#[test]
fn set_owner_reads_the_last_offsets_entry() {
    const ENTRIES: usize = 8;
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_phygital_token(&passkey);
    let claim = Claim::new(&mut ctx, token.phygital_token);

    let (single, mut args) =
        passkey.secp256r1_instruction_for_challenge(claim.challenge, claim.sign_count);
    let message = &single.data[MESSAGE_START..];
    let table_end = SIGNATURE_OFFSETS_START + ENTRIES * SIGNATURE_OFFSETS_SERIALIZED_SIZE;
    let public_key_offset = table_end;
    let signature_offset = public_key_offset + PUBLIC_KEY.len();
    let message_offset = signature_offset + SIGNATURE.len();

    let mut data = vec![ENTRIES as u8, 0];
    for _ in 0..ENTRIES {
        for field in [
            signature_offset as u16,
            u16::MAX,
            public_key_offset as u16,
            u16::MAX,
            message_offset as u16,
            message.len() as u16,
            u16::MAX,
        ] {
            data.extend_from_slice(&field.to_le_bytes());
        }
    }
    data.extend_from_slice(&single.data[PUBLIC_KEY]);
    data.extend_from_slice(&single.data[SIGNATURE]);
    data.extend_from_slice(message);
    let precompile = Instruction { data, ..single };
    args.signed_message_index = (ENTRIES - 1) as u8;

    claim
        .send(&mut ctx, vec![precompile], args)
        .expect("the last entry verifies");
    assert_eq!(
        ctx.phygital_token_owner(token.phygital_token),
        claim.recipient.pubkey()
    );
    assert_eq!(ctx.last_sign_count(token.phygital_token), claim.sign_count);
}
