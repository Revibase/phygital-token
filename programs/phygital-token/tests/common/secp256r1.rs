use super::{TEST_ORIGIN, TEST_RP_ID};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{SigningKey, VerifyingKey};
use phygital_token::utils::{
    build_spend_message_hash, build_transfer_message_hash, build_verify_message_hash, ActionType,
    Secp256r1VerifyArgs, COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID,
    SIGNATURE_OFFSETS_SERIALIZED_SIZE, SIGNATURE_OFFSETS_START,
};
use phygital_token::CredentialId;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

const SIGNATURE_SERIALIZED_SIZE: usize = 64;
const DATA_START: usize = SIGNATURE_OFFSETS_SERIALIZED_SIZE + SIGNATURE_OFFSETS_START;
const SECP256R1_HALF_ORDER: [u8; 32] = [
    0x7F, 0xFF, 0xFF, 0xFF, 0x80, 0x00, 0x00, 0x00, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xDE, 0x73, 0x7D, 0x56, 0xD3, 0x8B, 0xCF, 0x42, 0x79, 0xDC, 0xE5, 0x61, 0x7E, 0x31, 0x92, 0xA8,
];
const SECP256R1_ORDER: [u8; 32] = [
    0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84, 0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x51,
];

#[derive(Clone)]
pub struct TestPasskey {
    signing_key: SigningKey,
    pub compressed_pubkey: [u8; 33],
    pub credential_id: CredentialId,
}

impl TestPasskey {
    pub fn generate() -> Self {
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key = VerifyingKey::from(&signing_key);
        let compressed_pubkey = verifying_key
            .to_encoded_point(true)
            .as_bytes()
            .try_into()
            .expect("compressed secp256r1 pubkey");
        let credential_id = CredentialId::default();
        Self {
            signing_key,
            compressed_pubkey,
            credential_id,
        }
    }

    pub fn secp256r1_verify_instruction(
        &self,
        recipient: Pubkey,
        slot_number: u64,
        slot_hash: [u8; 32],
    ) -> (Instruction, Secp256r1VerifyArgs) {
        self.secp256r1_verify_instruction_with(recipient, slot_number, slot_hash, None)
    }

    pub fn secp256r1_verify_instruction_with(
        &self,
        recipient: Pubkey,
        slot_number: u64,
        slot_hash: [u8; 32],
        signature_override: Option<[u8; 64]>,
    ) -> (Instruction, Secp256r1VerifyArgs) {
        let message_hash = build_transfer_message_hash(&recipient);
        self.build_secp256r1_verify_instruction(
            ActionType::Transfer,
            message_hash,
            slot_number,
            slot_hash,
            signature_override,
            None,
        )
    }

    pub fn secp256r1_verify_instruction_with_auth_flags(
        &self,
        recipient: Pubkey,
        slot_number: u64,
        slot_hash: [u8; 32],
        auth_flags: u8,
    ) -> (Instruction, Secp256r1VerifyArgs) {
        let message_hash = build_transfer_message_hash(&recipient);
        self.build_secp256r1_verify_instruction(
            ActionType::Transfer,
            message_hash,
            slot_number,
            slot_hash,
            None,
            Some(auth_flags),
        )
    }

    pub fn verify_asset_secp256r1_instruction(
        &self,
        message: &str,
        slot_number: u64,
        slot_hash: [u8; 32],
    ) -> (Instruction, Secp256r1VerifyArgs) {
        self.verify_asset_secp256r1_instruction_with(message, slot_number, slot_hash, None)
    }

    pub fn verify_asset_secp256r1_instruction_with(
        &self,
        message: &str,
        slot_number: u64,
        slot_hash: [u8; 32],
        signature_override: Option<[u8; 64]>,
    ) -> (Instruction, Secp256r1VerifyArgs) {
        let message_hash = build_verify_message_hash(&message.to_string());
        self.build_secp256r1_verify_instruction(
            ActionType::Verify,
            message_hash,
            slot_number,
            slot_hash,
            signature_override,
            None,
        )
    }

    pub fn spend_secp256r1_instruction(
        &self,
        recipient: Pubkey,
        mint: Pubkey,
        amount: u64,
        slot_number: u64,
        slot_hash: [u8; 32],
    ) -> (Instruction, Secp256r1VerifyArgs) {
        let message_hash = build_spend_message_hash(&recipient, &mint, amount);
        self.build_secp256r1_verify_instruction(
            ActionType::Spend,
            message_hash,
            slot_number,
            slot_hash,
            None,
            None,
        )
    }

    fn build_secp256r1_verify_instruction(
        &self,
        action_type: ActionType,
        message_hash: [u8; 32],
        slot_number: u64,
        slot_hash: [u8; 32],
        signature_override: Option<[u8; 64]>,
        auth_flags: Option<u8>,
    ) -> (Instruction, Secp256r1VerifyArgs) {
        let mut challenge_buffer = Vec::new();
        challenge_buffer.extend_from_slice(action_type.to_bytes());
        challenge_buffer.extend_from_slice(&message_hash);
        challenge_buffer.extend_from_slice(&slot_hash);
        let expected_challenge: [u8; 32] = Sha256::digest(&challenge_buffer).into();

        let origin = TEST_ORIGIN;
        let mut client_data_json = Vec::new();
        client_data_json.extend_from_slice(br#"{"type":"webauthn.get","challenge":"#);
        Self::ccd_to_string(
            &URL_SAFE_NO_PAD.encode(expected_challenge),
            &mut client_data_json,
        );
        client_data_json.extend_from_slice(br#","origin":"#);
        Self::ccd_to_string(origin, &mut client_data_json);
        client_data_json.extend_from_slice(br#","crossOrigin":false}"#);

        let client_data_hash: [u8; 32] = Sha256::digest(&client_data_json).into();
        let rp_id_hash: [u8; 32] = Sha256::digest(TEST_RP_ID.as_bytes()).into();

        let mut authenticator_data = Vec::with_capacity(37);
        authenticator_data.extend_from_slice(&rp_id_hash);
        authenticator_data.push(auth_flags.unwrap_or(0x01));
        authenticator_data.extend_from_slice(&[0u8; 4]); // sign count

        let mut signed_message = Vec::with_capacity(authenticator_data.len() + 32);
        signed_message.extend_from_slice(&authenticator_data);
        signed_message.extend_from_slice(&client_data_hash);

        let signature_bytes = if let Some(bytes) = signature_override {
            bytes
        } else {
            let signature: p256::ecdsa::Signature = self.signing_key.sign(&signed_message);
            normalize_low_s(signature.to_bytes().into())
        };

        let ix = new_secp256r1_instruction_with_signature(
            &signed_message,
            &signature_bytes,
            &self.compressed_pubkey,
        );

        let verify_args = Secp256r1VerifyArgs {
            signed_message_index: 0,
            slot_number,
            client_data_json,
        };

        (ix, verify_args)
    }

    fn ccd_to_string(value: &str, output: &mut Vec<u8>) {
        output.push(b'"');
        output.extend_from_slice(value.as_bytes());
        output.push(b'"');
    }
}

fn cmp_be(a: &[u8], b: &[u8]) -> std::cmp::Ordering {
    a.cmp(b)
}

fn sub_be(order: &[u8; 32], value: &[u8]) -> [u8; 32] {
    let mut borrow = 0i16;
    let mut out = [0u8; 32];
    for i in (0..32).rev() {
        let diff = order[i] as i16 - value[i] as i16 - borrow;
        if diff < 0 {
            out[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            out[i] = diff as u8;
            borrow = 0;
        }
    }
    out
}

fn normalize_low_s(mut signature: [u8; 64]) -> [u8; 64] {
    let mut s = [0u8; 32];
    s.copy_from_slice(&signature[32..]);
    if cmp_be(&s, &SECP256R1_HALF_ORDER) != std::cmp::Ordering::Greater {
        return signature;
    }
    signature[32..].copy_from_slice(&sub_be(&SECP256R1_ORDER, &s));
    signature
}

fn new_secp256r1_instruction_with_signature(
    message: &[u8],
    signature: &[u8; SIGNATURE_SERIALIZED_SIZE],
    pubkey: &[u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE],
) -> Instruction {
    let public_key_offset = DATA_START;
    let signature_offset = public_key_offset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;
    let message_data_offset = signature_offset + SIGNATURE_SERIALIZED_SIZE;

    let mut instruction_data = Vec::with_capacity(message_data_offset + message.len());
    instruction_data.push(1);
    instruction_data.push(0);
    instruction_data.extend_from_slice(&(signature_offset as u16).to_le_bytes());
    instruction_data.extend_from_slice(&u16::MAX.to_le_bytes());
    instruction_data.extend_from_slice(&(public_key_offset as u16).to_le_bytes());
    instruction_data.extend_from_slice(&u16::MAX.to_le_bytes());
    instruction_data.extend_from_slice(&(message_data_offset as u16).to_le_bytes());
    instruction_data.extend_from_slice(&(message.len() as u16).to_le_bytes());
    instruction_data.extend_from_slice(&u16::MAX.to_le_bytes());
    instruction_data.extend_from_slice(pubkey);
    instruction_data.extend_from_slice(signature);
    instruction_data.extend_from_slice(message);

    Instruction {
        program_id: SECP256R1_PROGRAM_ID,
        accounts: vec![],
        data: instruction_data,
    }
}

pub fn current_slot_entry(svm: &litesvm::LiteSVM) -> (u64, [u8; 32]) {
    let slot_hashes: solana_slot_hashes::SlotHashes = svm.get_sysvar();
    let (slot, hash) = slot_hashes
        .first()
        .expect("slot hashes sysvar should contain at least one entry");
    (*slot, hash.to_bytes())
}
