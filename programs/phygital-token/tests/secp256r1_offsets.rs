//! The secp256r1 precompile verifies each signature over the key and message
//! found in whichever instruction its offsets name, but the program reads the
//! key and message from the precompile instruction's own data. These tests pin
//! that every offsets entry must name the precompile instruction itself, and
//! that a later entry is read from its own position in the table.
mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use common::{assert_phygital_token_program_error, TestContext, TestPasskey};
use phygital_token::{
    build_set_owner_challenge, secp256r1_self_contained as layout, Secp256r1VerifyArgs,
    SIGNATURE_OFFSETS_SERIALIZED_SIZE, SIGNATURE_OFFSETS_START,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

const OTHER_CHALLENGE: [u8; 32] = [10u8; 32];

fn point_at(ix: &mut Instruction, field: core::ops::Range<usize>, instruction: u16) {
    ix.data[field].copy_from_slice(&instruction.to_le_bytes());
}

/// A `set_owner` claim of `token` by a fresh, funded recipient.
struct Claim {
    token: Pubkey,
    recipient: Keypair,
    slot_number: u64,
    challenge: [u8; 32],
}

impl Claim {
    fn new(ctx: &mut TestContext, token: Pubkey) -> Self {
        let recipient = Keypair::new();
        ctx.svm.airdrop(&recipient.pubkey(), 1_000_000_000).unwrap();
        let (slot_number, slot_hash) = ctx.advance_past_last_slot(token);
        let challenge = build_set_owner_challenge(&token, &recipient.pubkey(), slot_hash);
        Self {
            token,
            challenge,
            recipient,
            slot_number,
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

#[test]
fn set_owner_rejects_a_public_key_read_from_another_instruction() {
    let mut ctx = TestContext::new();
    let victim = TestPasskey::generate();
    let token = ctx.init_phygital_token(&victim);
    let attacker = TestPasskey::generate();
    let claim = Claim::new(&mut ctx, token.phygital_token);

    let (signed_by_attacker, args) = attacker.secp256r1_instruction_for_challenge(claim.challenge);
    let mut forged = signed_by_attacker.clone();
    point_at(&mut forged, layout::SIGNATURE_INSTRUCTION_INDEX, 0);
    point_at(&mut forged, layout::PUBLIC_KEY_INSTRUCTION_INDEX, 0);
    point_at(&mut forged, layout::MESSAGE_INSTRUCTION_INDEX, 0);
    forged.data[layout::PUBLIC_KEY].copy_from_slice(&victim.compressed_pubkey);

    let result = claim.send(&mut ctx, vec![signed_by_attacker, forged], args);
    assert_phygital_token_program_error(result, "InvalidSignatureOffsets");
    assert_eq!(
        ctx.phygital_token_owner(token.phygital_token),
        Pubkey::default()
    );
    assert_eq!(ctx.last_slot(token.phygital_token), 0);
}

#[test]
fn set_owner_rejects_a_message_read_from_another_instruction() {
    let mut ctx = TestContext::new();
    let victim = TestPasskey::generate();
    let token = ctx.init_phygital_token(&victim);
    let claim = Claim::new(&mut ctx, token.phygital_token);

    let (old_signature, _) = victim.secp256r1_instruction_for_challenge(OTHER_CHALLENGE);
    let (mut forged, args) = victim.secp256r1_instruction_for_challenge(claim.challenge);
    point_at(&mut forged, layout::SIGNATURE_INSTRUCTION_INDEX, 0);
    point_at(&mut forged, layout::MESSAGE_INSTRUCTION_INDEX, 0);

    let result = claim.send(&mut ctx, vec![old_signature, forged], args);
    assert_phygital_token_program_error(result, "InvalidSignatureOffsets");
}

#[test]
fn set_owner_rejects_a_signature_read_from_another_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_phygital_token(&passkey);
    let claim = Claim::new(&mut ctx, token.phygital_token);

    let (genuine, args) = passkey.secp256r1_instruction_for_challenge(claim.challenge);
    let mut pointing = genuine.clone();
    point_at(&mut pointing, layout::SIGNATURE_INSTRUCTION_INDEX, 0);

    let result = claim.send(&mut ctx, vec![genuine, pointing], args);
    assert_phygital_token_program_error(result, "InvalidSignatureOffsets");
}

#[test]
fn set_owner_reads_the_last_offsets_entry() {
    const ENTRIES: usize = 8;
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_phygital_token(&passkey);
    let claim = Claim::new(&mut ctx, token.phygital_token);

    let (single, mut args) = passkey.secp256r1_instruction_for_challenge(claim.challenge);
    let message = &single.data[layout::MESSAGE_START..];
    let table_end = SIGNATURE_OFFSETS_START + ENTRIES * SIGNATURE_OFFSETS_SERIALIZED_SIZE;
    let public_key_offset = table_end;
    let signature_offset = public_key_offset + layout::PUBLIC_KEY.len();
    let message_offset = signature_offset + layout::SIGNATURE.len();

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
    data.extend_from_slice(&single.data[layout::PUBLIC_KEY]);
    data.extend_from_slice(&single.data[layout::SIGNATURE]);
    data.extend_from_slice(message);
    let precompile = Instruction { data, ..single };
    args.signature_index = (ENTRIES - 1) as u8;

    claim
        .send(&mut ctx, vec![precompile], args)
        .expect("the last entry verifies");
    assert_eq!(
        ctx.phygital_token_owner(token.phygital_token),
        claim.recipient.pubkey()
    );
    assert_eq!(ctx.last_slot(token.phygital_token), claim.slot_number);
}
