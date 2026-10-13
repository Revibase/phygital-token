//! Running instructions as the token's wallet PDA.
//!
//! Every token has a wallet PDA, `[WALLET_SEED, phygital_token]`, that can hold
//! assets. Two instructions sign as it:
//!
//! - `execute_with_owner`: the token's owner signs; nothing else is checked.
//! - `execute_with_accessory`: a tap signs, and the owner's policy limits which
//!   programs and instructions may run ([`crate::policy`]) and how much SOL and
//!   which tokens may leave ([`spend`]).
//!
//! Both must be top-level instructions in a transaction without a durable nonce
//! ([`guards`]). Inner instructions are given in compact form, indexing into
//! the instruction's remaining accounts.

mod cpi;
mod guards;
mod spend;
mod token_account;

use anchor_lang::prelude::*;

pub(crate) use cpi::execute_as_wallet;
pub(crate) use guards::require_direct_tx;

/// Indexes are into the execute instruction's remaining accounts.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct CompactInstruction {
    pub program_id_index: u8,
    pub account_indexes: Vec<u8>,
    pub data: Vec<u8>,
}
