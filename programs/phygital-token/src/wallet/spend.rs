//! Spend accounting for tapped executes.
//!
//! Before the inner instructions run, [`snapshot`] records the wallet's SOL and
//! every token account in the remaining accounts that the wallet owns or is
//! delegate of. Afterwards [`charge`] compares and charges each decrease to the
//! policy's SOL cap or the matching mint cap; a decrease no cap covers fails.
//!
//! Accounting choices, all conservative:
//! - Each account is measured on its own (`saturating_sub`): a gain in one
//!   account never offsets a loss in another.
//! - "Wallet SOL" includes the lamports of token accounts only the wallet can
//!   close (rent and wrapped SOL); lamports moved where someone else can
//!   close them count as spent.
//! - The wallet must keep control of its token accounts: no standing delegate
//!   and no new foreign close authority.

use anchor_lang::prelude::*;

use super::token_account::{is_token_program, token_account_view, TokenView};
use crate::constants::is_wsol_mint;
use crate::error::PhygitalError;
use crate::policy::PolicyView;

pub(super) struct Tracked {
    index: usize,
    cap_slot: Option<usize>,
    amount_before: u64,
    wallet_owned: bool,
    holds_wallet_sol: bool,
    mint: Pubkey,
    close_authority: Option<Pubkey>,
}

pub(super) struct Snapshot {
    sol_before: u64,
    tracked: Vec<Tracked>,
    /// By remaining-account index: a token account the wallet owned before the inner calls.
    wallet_owned_before: Vec<bool>,
}

pub(super) fn snapshot(
    view: &PolicyView,
    policy: &[u8],
    wallet: &AccountInfo,
    remaining: &[AccountInfo],
) -> Result<Snapshot> {
    let mut snapshot = Snapshot {
        sol_before: wallet.lamports(),
        tracked: Vec::new(),
        wallet_owned_before: vec![false; remaining.len()],
    };
    for (index, account) in token_accounts(remaining) {
        let Some(token) = token_account_view(&account.try_borrow_data()?) else {
            continue;
        };
        let wallet_owned = token.owner == *wallet.key;
        if !wallet_owned && token.delegate != Some(*wallet.key) {
            continue;
        }
        let holds_wallet_sol = holds_wallet_sol(&token, wallet.key);
        if holds_wallet_sol {
            snapshot.sol_before = snapshot.sol_before.saturating_add(account.lamports());
        }
        snapshot.wallet_owned_before[index] = wallet_owned;
        snapshot.tracked.push(Tracked {
            index,
            cap_slot: view.mint_slot(policy, &token.mint),
            amount_before: token.amount,
            wallet_owned,
            holds_wallet_sol,
            mint: token.mint,
            close_authority: token.close_authority,
        });
    }
    Ok(snapshot)
}

/// Every SOL or token spend needs a cap. SOL is the wallet's lamports plus
/// those of the token accounts only it can close (rent and wrapped SOL), so
/// lamports parked where someone else can close them count as spent. Also
/// checks the wallet kept control of its token accounts: no delegate and no
/// foreign close authority.
pub(super) fn charge(
    policy: &AccountInfo,
    view: &PolicyView,
    wallet: &AccountInfo,
    remaining: &[AccountInfo],
    snapshot: &Snapshot,
) -> Result<()> {
    let mut mint_spent = vec![0u64; view.mint_count()];
    for tracked in &snapshot.tracked {
        let account = &remaining[tracked.index];
        let token = token_account_view(&account.try_borrow_data()?);
        if tracked.wallet_owned {
            match &token {
                Some(token) => require!(
                    is_token_program(account.owner)
                        && token.owner == *wallet.key
                        && token.mint == tracked.mint
                        && token.close_authority == tracked.close_authority,
                    PhygitalError::TokenAuthorityChanged
                ),
                // Closed: its lamports are accounted for as SOL.
                None => require!(
                    account.lamports() == 0,
                    PhygitalError::TokenAuthorityChanged
                ),
            }
        }
        let spent = tracked
            .amount_before
            .saturating_sub(token.map_or(0, |token| token.amount));
        match tracked.cap_slot {
            Some(slot) => {
                mint_spent[slot] = mint_spent[slot]
                    .checked_add(spent)
                    .ok_or_else(|| error!(PhygitalError::SpendLimitExceeded))?
            }
            // Wrapped SOL the wallet controls is charged to the SOL cap below.
            None => require!(
                spent == 0 || tracked.holds_wallet_sol && is_wsol_mint(&tracked.mint),
                PhygitalError::SpendNotAllowed
            ),
        }
    }

    let mut sol_after = wallet.lamports();
    for (index, account) in token_accounts(remaining) {
        let Some(token) = token_account_view(&account.try_borrow_data()?) else {
            continue;
        };
        if token.owner != *wallet.key {
            continue;
        }
        if holds_wallet_sol(&token, wallet.key) {
            sol_after = sol_after.saturating_add(account.lamports());
        }
        require!(
            token.delegated_amount == 0,
            PhygitalError::DelegationNotAllowed
        );
        require!(
            snapshot.wallet_owned_before[index]
                || token.close_authority.is_none_or(|a| a == *wallet.key),
            PhygitalError::TokenAuthorityChanged
        );
    }

    let sol_spent = snapshot.sol_before.saturating_sub(sol_after);
    if sol_spent == 0 && mint_spent.iter().all(|spent| *spent == 0) {
        return Ok(());
    }
    let now = Clock::get()?.unix_timestamp;
    let mut data = policy.try_borrow_mut_data()?;
    if sol_spent > 0 {
        let mut cap = view
            .sol_cap(&data)
            .ok_or_else(|| error!(PhygitalError::SpendNotAllowed))?;
        cap.charge(sol_spent, now)?;
        if policy.is_writable {
            view.set_sol_cap(&mut data, &cap);
        }
    }
    for (slot, spent) in mint_spent.into_iter().enumerate() {
        if spent > 0 {
            let mut mint = view.mint_cap(&data, slot);
            mint.cap.charge(spent, now)?;
            if policy.is_writable {
                view.set_mint_cap(&mut data, slot, &mint);
            }
        }
    }
    Ok(())
}

fn token_accounts<'a, 'info>(
    remaining: &'a [AccountInfo<'info>],
) -> impl Iterator<Item = (usize, &'a AccountInfo<'info>)> {
    remaining
        .iter()
        .enumerate()
        .filter(move |(index, account)| {
            is_token_program(account.owner)
                && !remaining[..*index].iter().any(|o| o.key == account.key)
        })
}

fn holds_wallet_sol(view: &TokenView, wallet: &Pubkey) -> bool {
    view.owner == *wallet && view.close_authority.is_none_or(|a| a == *wallet)
}
