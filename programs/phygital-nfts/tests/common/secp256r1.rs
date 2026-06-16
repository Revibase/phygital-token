use anchor_lang::solana_program::instruction::Instruction;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{SigningKey, VerifyingKey};
use phygital_nfts::utils::{
    Secp256r1VerifyArgs, COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID,
    SIGNATURE_OFFSETS_SERIALIZED_SIZE, SIGNATURE_OFFSETS_START, TAP_MESSAGE_LEN,
};
use rand::rngs::OsRng;

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

/// Test stand-in for a physical NFC tag. The tag signs the fixed `counter || nonce`
/// message it generates on each tap; nothing about the transfer is part of the message.
#[derive(Clone)]
pub struct TestPasskey {
    signing_key: SigningKey,
    pub compressed_pubkey: [u8; 33],
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

        Self {
            signing_key,
            compressed_pubkey,
        }
    }

    /// Builds the dynamic-URL signed message for a tap: `counter(4 BE) || nonce(8)`.
    fn tap_message(counter: u32, nonce: [u8; 8]) -> [u8; TAP_MESSAGE_LEN] {
        let mut message = [0u8; TAP_MESSAGE_LEN];
        message[..4].copy_from_slice(&counter.to_be_bytes());
        message[4..].copy_from_slice(&nonce);
        message
    }

    /// Builds the secp256r1 precompile instruction verifying this tag's signature over
    /// `counter || nonce`, plus the matching `Secp256r1VerifyArgs`.
    pub fn secp256r1_verify_instruction(
        &self,
        counter: u32,
        nonce: [u8; 8],
    ) -> (Instruction, Secp256r1VerifyArgs) {
        self.secp256r1_verify_instruction_with(counter, nonce, None)
    }

    pub fn secp256r1_verify_instruction_with(
        &self,
        counter: u32,
        nonce: [u8; 8],
        signature_override: Option<[u8; 64]>,
    ) -> (Instruction, Secp256r1VerifyArgs) {
        let message = Self::tap_message(counter, nonce);

        let signature_bytes = if let Some(bytes) = signature_override {
            bytes
        } else {
            let signature: p256::ecdsa::Signature = self.signing_key.sign(&message);
            normalize_low_s(signature.to_bytes().into())
        };

        let ix = new_secp256r1_instruction_with_signature(
            &message,
            &signature_bytes,
            &self.compressed_pubkey,
        );

        let verify_args = Secp256r1VerifyArgs {
            instruction_index: 0,
            signed_message_index: 0,
        };

        (ix, verify_args)
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
