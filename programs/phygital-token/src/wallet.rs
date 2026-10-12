use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{
    get_stack_height, AccountMeta, Instruction, TRANSACTION_LEVEL_STACK_HEIGHT,
};
use anchor_lang::solana_program::program::invoke_signed;
use solana_sha256_hasher::hashv;

use crate::constants::{is_wsol_mint, SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, WALLET_SEED};
use crate::error::PhygitalError;
use crate::policy::PolicyView;
use crate::rules::check_instruction;
use crate::webauthn::instruction_parts;

/// Indexes are into the execute instruction's remaining accounts.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct CompactInstruction {
    pub program_id_index: u8,
    pub account_indexes: Vec<u8>,
    pub data: Vec<u8>,
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

pub(crate) fn require_direct_tx(instructions_sysvar: &AccountInfo) -> Result<()> {
    require!(
        get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
        PhygitalError::ExecuteViaCpiNotAllowed
    );
    let sysvar = instructions_sysvar.try_borrow_data()?;
    let (program_id, data) = instruction_parts(&sysvar, 0)?;
    const ADVANCE_NONCE: [u8; 4] = 4u32.to_le_bytes();
    require!(
        program_id != system_program::ID.as_ref() || !data.starts_with(&ADVANCE_NONCE),
        PhygitalError::DurableNonceNotAllowed
    );
    Ok(())
}

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

pub(crate) fn close_policy_if_exists<'info>(
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

struct Tracked {
    index: usize,
    cap_slot: Option<usize>,
    amount_before: u64,
    wallet_owned: bool,
    holds_wallet_sol: bool,
    mint: Pubkey,
    close_authority: Option<Pubkey>,
}

struct Snapshot {
    sol_before: u64,
    tracked: Vec<Tracked>,
    /// By remaining-account index: a token account the wallet owned before the inner calls.
    wallet_owned_before: Vec<bool>,
}

fn snapshot(
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
fn charge(
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

fn is_token_program(owner: &Pubkey) -> bool {
    *owner == SPL_TOKEN_PROGRAM_ID || *owner == TOKEN_2022_PROGRAM_ID
}

struct TokenView {
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
    delegate: Option<Pubkey>,
    delegated_amount: u64,
    close_authority: Option<Pubkey>,
}

/// SPL Token layout: mint 0..32, owner 32..64, amount 64..72, delegate COption
/// 72..108, state 108, delegated_amount 121..129, close_authority COption
/// 129..165; Token-2022 puts the account type at 165.
fn token_account_view(data: &[u8]) -> Option<TokenView> {
    if data.len() < 165 || (data.len() > 165 && data[165] != 2) || !matches!(data[108], 1 | 2) {
        return None;
    }
    let pubkey = |at: usize| Pubkey::try_from(&data[at..at + 32]).ok();
    let coption = |at: usize| {
        (data[at..at + 4] == [1, 0, 0, 0])
            .then(|| pubkey(at + 4))
            .flatten()
    };
    let u64_at = |at: usize| data[at..at + 8].try_into().ok().map(u64::from_le_bytes);
    Some(TokenView {
        mint: pubkey(0)?,
        owner: pubkey(32)?,
        amount: u64_at(64)?,
        delegate: coption(72),
        delegated_amount: u64_at(121)?,
        close_authority: coption(129),
    })
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
