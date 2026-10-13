//! Matching an inner instruction against the stored program permissions.
//!
//! [`check_instruction`] walks the Borsh encoding of `Vec<ProgramPermission>`
//! (see [`super::permissions`]) directly. The enum tags it matches are the Borsh
//! variant indexes of those types, in declaration order:
//!
//! - `ProgramAccess`: 0 `AllInstructions`, 1 `Restricted`
//! - `AccountKeyConstraint`: 0 `Any`, 1 `Address`, 2 `Wallet`
//! - `DataPredicate`: 0 `BytesEqual`, 1 `Unsigned`
//! - `NumericWidth`: 0 `U8`, 1 `U16`, 2 `U32`, 3 `U64`
//! - `Comparison`: 0 `Equal` ... 5 `GreaterThanOrEqual`
//!
//! Each matcher consumes its whole encoding even after a mismatch, so the
//! cursor stays aligned for the next rule. The wallet PDA counts as a signer,
//! since the CPI grants it that privilege.

use anchor_lang::prelude::*;

use super::reader::Reader;
use crate::error::PhygitalError;
use crate::wallet::CompactInstruction;

struct Target<'a, 'info> {
    ix: &'a CompactInstruction,
    remaining: &'a [AccountInfo<'info>],
    wallet: &'a Pubkey,
}

/// `permissions` is the stored Borsh `Vec<ProgramPermission>`.
pub(crate) fn check_instruction(
    permissions: &[u8],
    program: &Pubkey,
    ix: &CompactInstruction,
    remaining: &[AccountInfo],
    wallet: &Pubkey,
) -> Result<()> {
    let target = Target {
        ix,
        remaining,
        wallet,
    };
    let mut r = Reader::new(permissions, 0);
    for _ in 0..r.u32()? {
        let listed = r.take(32)? == program.as_ref();
        match r.u8()? {
            0 if listed => return Ok(()),
            0 => {}
            1 => {
                for _ in 0..r.u32()? {
                    if rule_matches(&mut r, listed.then_some(&target))? {
                        return Ok(());
                    }
                }
                if listed {
                    return err!(PhygitalError::InstructionNotAllowed);
                }
            }
            _ => return err!(ErrorCode::AccountDidNotDeserialize),
        }
    }
    err!(PhygitalError::ProgramNotAllowed)
}

fn rule_matches(r: &mut Reader, target: Option<&Target>) -> Result<bool> {
    let selector = r.bytes()?;
    let data_length = r.option(|r| r.array().map(u16::from_le_bytes))?;
    let account_count = r.option(|r| r.u8())?;
    let mut ok = target.is_some_and(|t| {
        t.ix.data.starts_with(selector)
            && data_length.is_none_or(|len| usize::from(len) == t.ix.data.len())
            && account_count.is_none_or(|count| usize::from(count) == t.ix.account_indexes.len())
    });
    for _ in 0..r.u32()? {
        ok &= account_matches(r, target.filter(|_| ok))?;
    }
    for _ in 0..r.u32()? {
        ok &= data_matches(r, target.filter(|_| ok).map(|t| &t.ix.data[..]))?;
    }
    Ok(ok)
}

fn account_matches(r: &mut Reader, target: Option<&Target>) -> Result<bool> {
    let index = usize::from(r.u8()?);
    let key = match r.u8()? {
        0 => None,
        1 => Some(Some(r.take(32)?)),
        2 => Some(None),
        _ => return err!(ErrorCode::AccountDidNotDeserialize),
    };
    let owner = r.option(|r| r.take(32))?;
    let is_signer = r.option(|r| r.u8())?;
    let is_writable = r.option(|r| r.u8())?;
    let account = target.and_then(|t| {
        let account = t
            .remaining
            .get(usize::from(*t.ix.account_indexes.get(index)?))?;
        Some((account, account.key == t.wallet))
    });
    let mut ok = account.is_some_and(|(account, is_wallet)| {
        key.is_none_or(|address| match address {
            Some(address) => account.key.as_ref() == address,
            None => is_wallet,
        }) && owner.is_none_or(|owner| account.owner.as_ref() == owner)
            && is_signer.is_none_or(|signer| (signer == 1) == (account.is_signer || is_wallet))
            && is_writable.is_none_or(|writable| (writable == 1) == account.is_writable)
    });
    let data = match account {
        Some((account, _)) if ok => account.try_borrow_data().ok(),
        _ => None,
    };
    for _ in 0..r.u32()? {
        ok &= data_matches(r, data.as_deref().map(|data| &data[..]).filter(|_| ok))?;
    }
    Ok(ok)
}

fn data_matches(r: &mut Reader, data: Option<&[u8]>) -> Result<bool> {
    let offset = usize::from(u16::from_le_bytes(r.array()?));
    let at = |len: usize| data.and_then(|data| data.get(offset..offset.checked_add(len)?));
    Ok(match r.u8()? {
        0 => {
            let expected = r.bytes()?;
            at(expected.len()) == Some(expected)
        }
        1 => {
            let width = [1, 2, 4, 8]
                .get(usize::from(r.u8()?))
                .copied()
                .ok_or_else(|| error!(ErrorCode::AccountDidNotDeserialize))?;
            let comparison = r.u8()?;
            require!(comparison <= 5, ErrorCode::AccountDidNotDeserialize);
            let value = u64::from_le_bytes(r.array()?);
            at(width).is_some_and(|bytes| {
                let mut padded = [0u8; 8];
                padded[..width].copy_from_slice(bytes);
                let actual = u64::from_le_bytes(padded);
                match comparison {
                    0 => actual == value,
                    1 => actual != value,
                    2 => actual < value,
                    3 => actual <= value,
                    4 => actual > value,
                    _ => actual >= value,
                }
            })
        }
        _ => return err!(ErrorCode::AccountDidNotDeserialize),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::permissions::*;

    fn encode(value: &impl AnchorSerialize) -> Vec<u8> {
        let mut bytes = Vec::new();
        value.serialize(&mut bytes).unwrap();
        bytes
    }

    fn data_ok(check: &DataConstraint, data: &[u8]) -> bool {
        data_matches(&mut Reader::new(&encode(check), 0), Some(data)).unwrap()
    }

    fn rule_ok(
        rule: &InstructionRule,
        ix: &CompactInstruction,
        remaining: &[AccountInfo],
        wallet: &Pubkey,
    ) -> bool {
        let target = Target {
            ix,
            remaining,
            wallet,
        };
        rule_matches(&mut Reader::new(&encode(rule), 0), Some(&target)).unwrap()
    }

    #[test]
    fn numeric_widths_comparisons_and_short_reads() {
        for width in [
            NumericWidth::U8,
            NumericWidth::U16,
            NumericWidth::U32,
            NumericWidth::U64,
        ] {
            for comparison in [
                Comparison::Equal,
                Comparison::NotEqual,
                Comparison::LessThan,
                Comparison::LessThanOrEqual,
                Comparison::GreaterThan,
                Comparison::GreaterThanOrEqual,
            ] {
                let check = DataConstraint {
                    offset: 1,
                    predicate: DataPredicate::Unsigned {
                        width,
                        comparison,
                        value: 42,
                    },
                };
                for actual in [41u64, 42, 43] {
                    let mut data = vec![255];
                    data.extend_from_slice(&actual.to_le_bytes()[..width.bytes()]);
                    let expected = match comparison {
                        Comparison::Equal => actual == 42,
                        Comparison::NotEqual => actual != 42,
                        Comparison::LessThan => actual < 42,
                        Comparison::LessThanOrEqual => actual <= 42,
                        Comparison::GreaterThan => actual > 42,
                        Comparison::GreaterThanOrEqual => actual >= 42,
                    };
                    assert_eq!(data_ok(&check, &data), expected);
                    data.pop();
                    assert!(!data_ok(&check, &data));
                }
            }
        }
        let bytes = DataConstraint {
            offset: u16::MAX,
            predicate: DataPredicate::BytesEqual(vec![1]),
        };
        assert!(!data_ok(&bytes, &[1]));
    }

    #[test]
    fn matcher_resolves_instruction_positions_and_effective_privileges() {
        let key = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let mut lamports = 0;
        let mut data = [7, 8];
        let account = AccountInfo::new(&key, false, true, &mut lamports, &mut data, &owner, false);
        let remaining = [account];
        let ix = CompactInstruction {
            program_id_index: 0,
            account_indexes: vec![0],
            data: vec![1],
        };
        let mut rule = InstructionRule {
            selector: vec![1],
            data_length: None,
            account_count: None,
            accounts: vec![AccountConstraint {
                index: 0,
                key: AccountKeyConstraint::Wallet,
                owner: Some(owner),
                is_signer: Some(true),
                is_writable: Some(true),
                data: vec![],
            }],
            arguments: vec![],
        };
        assert!(rule_ok(&rule, &ix, &remaining, &key)); // PDA gains its signature.
        rule.accounts[0].is_signer = Some(false);
        assert!(!rule_ok(&rule, &ix, &remaining, &key));
        rule.accounts[0].is_signer = Some(true);
        rule.accounts[0].is_writable = Some(false);
        assert!(!rule_ok(&rule, &ix, &remaining, &key));
        rule.accounts[0].is_writable = Some(true);
        rule.accounts[0].owner = Some(Pubkey::new_unique());
        assert!(!rule_ok(&rule, &ix, &remaining, &key));
        rule.accounts[0].owner = Some(owner);
        rule.accounts[0].index = 1;
        assert!(!rule_ok(&rule, &ix, &remaining, &key));
        rule.accounts[0].index = 0;
        let invalid = CompactInstruction {
            account_indexes: vec![255],
            ..ix
        };
        assert!(!rule_ok(&rule, &invalid, &remaining, &key));
    }
}

/// The matcher hard-codes Borsh variant tags; these pin them to the types.
#[cfg(test)]
mod tag_tests {
    use crate::policy::permissions::*;
    use anchor_lang::prelude::*;

    fn tag(value: &impl AnchorSerialize) -> u8 {
        let mut bytes = Vec::new();
        value.serialize(&mut bytes).unwrap();
        bytes[0]
    }

    #[test]
    fn enum_tags_match_the_matcher() {
        assert_eq!(tag(&ProgramAccess::AllInstructions), 0);
        assert_eq!(tag(&ProgramAccess::Restricted(vec![])), 1);
        assert_eq!(tag(&AccountKeyConstraint::Any), 0);
        assert_eq!(tag(&AccountKeyConstraint::Address(Pubkey::default())), 1);
        assert_eq!(tag(&AccountKeyConstraint::Wallet), 2);
        assert_eq!(tag(&DataPredicate::BytesEqual(vec![])), 0);
        let unsigned = DataPredicate::Unsigned {
            width: NumericWidth::U8,
            comparison: Comparison::Equal,
            value: 0,
        };
        assert_eq!(tag(&unsigned), 1);
        let widths = [
            NumericWidth::U8,
            NumericWidth::U16,
            NumericWidth::U32,
            NumericWidth::U64,
        ];
        for (i, width) in widths.into_iter().enumerate() {
            assert_eq!(usize::from(tag(&width)), i);
        }
        let comparisons = [
            Comparison::Equal,
            Comparison::NotEqual,
            Comparison::LessThan,
            Comparison::LessThanOrEqual,
            Comparison::GreaterThan,
            Comparison::GreaterThanOrEqual,
        ];
        for (i, comparison) in comparisons.into_iter().enumerate() {
            assert_eq!(usize::from(tag(&comparison)), i);
        }
    }
}
