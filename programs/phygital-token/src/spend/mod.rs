//! Tap payments: the owner's limits ([`crate::state::SpendPolicy`]), the SPL
//! token accounts a payment touches, and the CPI that moves the tokens.

mod actions;
mod guards;
mod token_account;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::system_program::{assign, transfer, Assign, Transfer};

pub use actions::SpendPolicyAction;
pub(crate) use guards::require_direct_tx;
pub(crate) use token_account::{token_account_view, TokenView};

use crate::constants::{is_token_program, DELEGATE_SEED};
use crate::error::PhygitalError;

/// Closes the token's spend policy, if one exists, sending its rent to `receiver`.
///
/// Every instruction that changes `phygital_token.owner` to someone else must
/// call this, so a new owner never inherits the previous owner's limits.
pub(crate) fn close_spend_policy_if_exists<'info>(
    policy: &AccountInfo<'info>,
    receiver: &AccountInfo<'info>,
) -> Result<()> {
    if *policy.owner != crate::ID {
        return Ok(());
    }
    let lamports = policy.lamports();
    policy.sub_lamports(lamports)?;
    receiver.add_lamports(lamports)?;
    policy.assign(&system_program::ID);
    policy.resize(0)?;
    Ok(())
}

/// Makes the PDA `info` (signed for by `seeds`) a program account of `len`
/// bytes, creating it if needed. `payer` covers any rent increase; rent freed
/// by shrinking stays in the account until it closes.
pub(crate) fn fit_pda<'info>(
    info: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    seeds: &[&[u8]],
    len: usize,
) -> Result<()> {
    let top_up = Rent::get()?
        .minimum_balance(len)
        .saturating_sub(info.lamports());
    if top_up > 0 {
        transfer(
            CpiContext::new(
                system_program.key(),
                Transfer {
                    from: payer.clone(),
                    to: info.clone(),
                },
            ),
            top_up,
        )?;
    }
    if *info.owner != crate::ID {
        // Assign rather than create_account, so an address someone pre-funded
        // can still be used.
        assign(
            CpiContext::new_with_signer(
                system_program.key(),
                Assign {
                    account_to_assign: info.clone(),
                },
                &[seeds],
            ),
            &crate::ID,
        )?;
    }
    info.resize(len)?;
    Ok(())
}

/// Reads a token account owned by `token_program`.
pub(crate) fn read_token_account(info: &AccountInfo, token_program: &Pubkey) -> Result<TokenView> {
    require!(
        is_token_program(token_program) && info.owner == token_program,
        PhygitalError::InvalidTokenAccount
    );
    token_account_view(&info.try_borrow_data()?)
        .ok_or_else(|| error!(PhygitalError::InvalidTokenAccount))
}

/// `transfer_checked` (instruction 12, identical in SPL Token and Token-2022)
/// from `source` as its delegate, the owner's delegate PDA.
#[allow(clippy::too_many_arguments)]
pub(crate) fn transfer_as_delegate<'info>(
    token_program: &AccountInfo<'info>,
    source: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    delegate: &AccountInfo<'info>,
    owner: &Pubkey,
    delegate_bump: u8,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let mut data = Vec::with_capacity(10);
    data.push(12);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    let instruction = Instruction {
        program_id: token_program.key(),
        accounts: vec![
            AccountMeta::new(source.key(), false),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new(destination.key(), false),
            AccountMeta::new_readonly(delegate.key(), true),
        ],
        data,
    };
    invoke_signed(
        &instruction,
        &[
            source.clone(),
            mint.clone(),
            destination.clone(),
            delegate.clone(),
            token_program.clone(),
        ],
        &[&[DELEGATE_SEED, owner.as_ref(), &[delegate_bump]]],
    )?;
    Ok(())
}
