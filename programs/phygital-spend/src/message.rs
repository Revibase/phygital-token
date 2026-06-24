use anchor_lang::prelude::*;

/// Domain tag prefixed to every spend-authorization message so a `verify_asset` message intended
/// for something else can never be mistaken for a spend authorization.
pub const SPEND_MESSAGE_TAG: &[u8] = b"phygital-spend";

/// Canonical `verify_asset` message bytes that authorize a spend. The passkey holder signs these
/// exact bytes (via the `verify_asset` CPI), binding the spend to a specific recipient, mint, and
/// amount. The spend program reconstructs them from its own accounts/args before invoking
/// `verify_asset`.
pub fn build_spend_verify_message(recipient: &Pubkey, mint: &Pubkey, amount: u64) -> Vec<u8> {
    let mut message = Vec::with_capacity(SPEND_MESSAGE_TAG.len() + 32 + 32 + 8);
    message.extend_from_slice(SPEND_MESSAGE_TAG);
    message.extend_from_slice(recipient.as_ref());
    message.extend_from_slice(mint.as_ref());
    message.extend_from_slice(&amount.to_le_bytes());
    message
}
