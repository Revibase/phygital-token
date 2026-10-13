//! The exact 32-byte challenges a tap must sign.
//!
//! Each challenge starts with a domain tag, so a signature for one action can
//! never be replayed as another, and includes a recent slot hash, so it expires
//! once that slot leaves the SlotHashes sysvar (the latest 512 slots). The
//! authenticator's sign count, which must strictly increase, stops replay
//! within that window. Clients rebuild these byte for byte (see the SDK's
//! `buildExecuteChallenge`), so the formats are part of the interface.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::error::PhygitalError;
use crate::wallet::CompactInstruction;

/// WebAuthn challenge for `set_owner`:
/// `SHA256("transfer" || phygital_token || slot_hash || recipient)`.
///
/// Binding `recipient` means a tap authorizes one specific new owner: anyone
/// who sees the assertion before it lands cannot resubmit it for themselves.
/// (The `"transfer"` tag predates the instruction's name.)
pub fn build_set_owner_challenge(
    phygital_token: &Pubkey,
    slot_hash: [u8; 32],
    recipient: &Pubkey,
) -> [u8; 32] {
    hashv(&[
        b"transfer",
        phygital_token.as_ref(),
        &slot_hash,
        recipient.as_ref(),
    ])
    .to_bytes()
}

/// `SHA256("execute" || phygital_token || slot_hash || borsh(instructions) || accounts)`,
/// where `accounts` is, for each instruction's program then accounts, the key
/// followed by `is_signer | is_writable << 1`.
pub fn build_execute_challenge<'a>(
    phygital_token: &Pubkey,
    slot_hash: &[u8; 32],
    instructions: &[CompactInstruction],
    account: impl Fn(usize) -> Option<(&'a Pubkey, bool, bool)>,
) -> Result<[u8; 32]> {
    // Sized up front: the bump allocator never frees, so regrowing would waste heap.
    let referenced: usize = instructions
        .iter()
        .map(|ix| 1 + ix.account_indexes.len())
        .sum();
    let packed_len = 4 + instructions
        .iter()
        .map(|ix| 1 + 4 + ix.account_indexes.len() + 4 + ix.data.len())
        .sum::<usize>();
    let mut packed = Vec::with_capacity(packed_len);
    instructions.serialize(&mut packed)?;
    let mut accounts = Vec::with_capacity(referenced * 33);
    for ix in instructions {
        for &index in core::iter::once(&ix.program_id_index).chain(&ix.account_indexes) {
            let (key, is_signer, is_writable) =
                account(index.into()).ok_or_else(|| error!(PhygitalError::InvalidAccountIndex))?;
            accounts.extend_from_slice(key.as_ref());
            accounts.push(u8::from(is_signer) | (u8::from(is_writable) << 1));
        }
    }
    Ok(hashv(&[
        b"execute",
        phygital_token.as_ref(),
        slot_hash,
        &packed,
        &accounts,
    ])
    .to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shared with the JS SDK's `buildExecuteChallenge` test.
    #[test]
    fn execute_challenge_vector() {
        let token = Pubkey::new_from_array([1; 32]);
        let keys = [[3; 32], [4; 32], [5; 32]].map(Pubkey::new_from_array);
        let flags = [(false, false), (false, true), (true, true)];
        let instructions = [CompactInstruction {
            program_id_index: 0,
            account_indexes: vec![1, 2],
            data: vec![2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0],
        }];
        let challenge = build_execute_challenge(&token, &[2; 32], &instructions, |i| {
            keys.get(i).map(|key| (key, flags[i].0, flags[i].1))
        })
        .unwrap();
        let hex: String = challenge.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "1f3caba256268aa7782228a5e86e9bb0292e17fa8b1578ab93308cadb02aad77"
        );
    }
}
