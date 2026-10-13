//! The CPI loop that signs inner instructions as the wallet PDA.
//!
//! Invariants enforced for every inner instruction:
//! - it may not call this program (`SelfReentrancyNotAllowed`);
//! - `protected` accounts (the token, and on the tap path the policy) may not
//!   be passed as signer or writable (`ProtectedAccountPrivilege`);
//! - on the tap path, the policy's program permissions must allow it.
//!
//! After all inner instructions, the wallet's owner program and data length
//! must be unchanged (`WalletInvariantViolated`) and, on the tap path, spends
//! are charged to the policy's caps.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use super::spend::{charge, snapshot};
use super::CompactInstruction;
use crate::constants::WALLET_SEED;
use crate::error::PhygitalError;
use crate::policy::{check_instruction, PolicyView};

/// Without a `policy` (the owner path) no permission or cap applies.
pub(crate) fn execute_as_wallet<'info>(
    wallet: &AccountInfo<'info>,
    phygital_token: &Pubkey,
    wallet_bump: u8,
    protected: &[Pubkey],
    remaining: &[AccountInfo<'info>],
    instructions: Vec<CompactInstruction>,
    policy: Option<(&AccountInfo<'info>, &PolicyView)>,
) -> Result<()> {
    let before = match policy {
        Some((info, view)) => Some(snapshot(view, &info.try_borrow_data()?, wallet, remaining)?),
        None => None,
    };
    let (owner_before, len_before) = (*wallet.owner, wallet.data_len());
    let bump = [wallet_bump];
    let seeds: &[&[&[u8]]] = &[&[WALLET_SEED, phygital_token.as_ref(), &bump]];

    for ix in instructions {
        let program = account_at(remaining, ix.program_id_index)?.key;
        require_keys_neq!(*program, crate::ID, PhygitalError::SelfReentrancyNotAllowed);
        if let Some((info, view)) = policy {
            let data = info.try_borrow_data()?;
            check_instruction(view.permissions(&data), program, &ix, remaining, wallet.key)?;
        }
        let accounts = ix
            .account_indexes
            .iter()
            .map(|&index| {
                let account = account_at(remaining, index)?;
                require!(
                    !protected.contains(account.key) || !(account.is_signer || account.is_writable),
                    PhygitalError::ProtectedAccountPrivilege
                );
                Ok(AccountMeta {
                    pubkey: *account.key,
                    is_signer: account.is_signer || account.key == wallet.key,
                    is_writable: account.is_writable,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let ix = Instruction {
            program_id: *program,
            accounts,
            data: ix.data,
        };
        invoke_signed(&ix, remaining, seeds)?;
    }

    require!(
        *wallet.owner == owner_before && wallet.data_len() == len_before,
        PhygitalError::WalletInvariantViolated
    );
    match (policy, before) {
        (Some((info, view)), Some(before)) => charge(info, view, wallet, remaining, &before),
        _ => Ok(()),
    }
}

fn account_at<'a, 'info>(
    remaining: &'a [AccountInfo<'info>],
    index: u8,
) -> Result<&'a AccountInfo<'info>> {
    remaining
        .get(usize::from(index))
        .ok_or_else(|| error!(PhygitalError::InvalidAccountIndex))
}
