use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::utils::{get_allowed_recipient, get_payment_token_mint, get_transfer_price};

/// Seller-controlled transfer terms bound into the passkey-signed message.
/// Collection/domain royalties are optional and read at execution from on-chain metadata.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TransferTerms {
    pub price: u64,
    pub payment_token_mint: Pubkey,
    pub allowed_recipient: Pubkey,
}

impl Default for TransferTerms {
    fn default() -> Self {
        Self {
            price: 0,
            payment_token_mint: Pubkey::default(),
            allowed_recipient: Pubkey::default(),
        }
    }
}

pub fn read_transfer_terms(token_mint: &AccountInfo) -> Result<TransferTerms> {
    Ok(TransferTerms {
        price: get_transfer_price(token_mint)?,
        payment_token_mint: get_payment_token_mint(token_mint)?.unwrap_or_default(),
        allowed_recipient: get_allowed_recipient(token_mint)?.unwrap_or_default(),
    })
}

pub fn build_transfer_message_hash(
    token_mint: &Pubkey,
    sender: &Pubkey,
    recipient: &Pubkey,
    terms: &TransferTerms,
) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(128);
    buffer.extend_from_slice(token_mint.as_ref());
    buffer.extend_from_slice(sender.as_ref());
    buffer.extend_from_slice(recipient.as_ref());
    buffer.extend_from_slice(&terms.price.to_le_bytes());
    buffer.extend_from_slice(terms.payment_token_mint.as_ref());
    buffer.extend_from_slice(terms.allowed_recipient.as_ref());
    Sha256::digest(&buffer).into()
}
