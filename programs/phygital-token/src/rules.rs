use crate::error::PhygitalError;
use crate::wallet::CompactInstruction;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ProgramPermission {
    pub program_id: Pubkey,
    pub access: ProgramAccess,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum ProgramAccess {
    AllInstructions,
    Restricted(Vec<InstructionRule>),
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct InstructionRule {
    pub selector: Vec<u8>,
    pub data_length: Option<u16>,
    pub account_count: Option<u8>,
    pub accounts: Vec<AccountConstraint>,
    pub arguments: Vec<DataConstraint>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum AccountKeyConstraint {
    Any,
    Address(Pubkey),
    Wallet,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AccountConstraint {
    pub index: u8,
    pub key: AccountKeyConstraint,
    /// The program owning the account. A token account's owner field is data:
    /// match it with `data` (offset 32).
    pub owner: Option<Pubkey>,
    pub is_signer: Option<bool>,
    pub is_writable: Option<bool>,
    pub data: Vec<DataConstraint>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Comparison {
    Equal,
    NotEqual,
    LessThan,
    LessThanOrEqual,
    GreaterThan,
    GreaterThanOrEqual,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum NumericWidth {
    U8,
    U16,
    U32,
    U64,
}

impl NumericWidth {
    fn bytes(self) -> usize {
        match self {
            Self::U8 => 1,
            Self::U16 => 2,
            Self::U32 => 4,
            Self::U64 => 8,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum DataPredicate {
    BytesEqual(Vec<u8>),
    Unsigned {
        width: NumericWidth,
        comparison: Comparison,
        value: u64,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct DataConstraint {
    pub offset: u16,
    pub predicate: DataPredicate,
}

impl DataConstraint {
    fn width(&self) -> usize {
        match &self.predicate {
            DataPredicate::BytesEqual(bytes) => bytes.len(),
            DataPredicate::Unsigned { width, .. } => width.bytes(),
        }
    }
    fn validate(&self) -> Result<()> {
        match &self.predicate {
            DataPredicate::BytesEqual(bytes) => {
                require!(!bytes.is_empty(), PhygitalError::InvalidPolicyArgs)
            }
            DataPredicate::Unsigned { width, value, .. } => {
                let bits = width.bytes() * 8;
                require!(
                    bits == 64 || *value < (1u64 << bits),
                    PhygitalError::InvalidPolicyArgs
                );
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_permissions(permissions: &[ProgramPermission]) -> Result<()> {
    for (i, permission) in permissions.iter().enumerate() {
        // System program id is all-zero and must be configurable.
        require!(
            !permissions[..i]
                .iter()
                .any(|p| p.program_id == permission.program_id),
            PhygitalError::InvalidPolicyArgs
        );
        require!(
            permission.program_id != crate::ID,
            PhygitalError::InvalidPolicyArgs
        );
        let ProgramAccess::Restricted(rules) = &permission.access else {
            continue;
        };
        require!(!rules.is_empty(), PhygitalError::InvalidPolicyArgs);
        for (j, rule) in rules.iter().enumerate() {
            require!(!rule.selector.is_empty(), PhygitalError::InvalidPolicyArgs);
            // One rule per instruction: rules match by selector prefix, so no selector may prefix another.
            require!(
                !rules[..j]
                    .iter()
                    .any(|other| other.selector.starts_with(&rule.selector)
                        || rule.selector.starts_with(&other.selector)),
                PhygitalError::InvalidPolicyArgs
            );
            if let Some(length) = rule.data_length {
                require!(
                    usize::from(length) >= rule.selector.len(),
                    PhygitalError::InvalidPolicyArgs
                );
            }
            for argument in &rule.arguments {
                argument.validate()?;
                if let Some(length) = rule.data_length {
                    require!(
                        usize::from(argument.offset) + argument.width() <= usize::from(length),
                        PhygitalError::InvalidPolicyArgs
                    );
                }
            }
            for account in &rule.accounts {
                if let Some(count) = rule.account_count {
                    require!(account.index < count, PhygitalError::InvalidPolicyArgs);
                }
                require!(
                    account.data.is_empty() || account.owner.is_some(),
                    PhygitalError::InvalidPolicyArgs
                );
                for predicate in &account.data {
                    predicate.validate()?;
                }
            }
        }
    }
    Ok(())
}

/// Reads the stored policy bytes in place.
pub(crate) struct Reader<'a> {
    data: &'a [u8],
    pub(crate) pos: usize,
}

impl<'a> Reader<'a> {
    pub(crate) fn new(data: &'a [u8], pos: usize) -> Self {
        Self { data, pos }
    }

    pub(crate) fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let bytes = self
            .pos
            .checked_add(len)
            .and_then(|end| self.data.get(self.pos..end))
            .ok_or_else(|| error!(ErrorCode::AccountDidNotDeserialize))?;
        self.pos += len;
        Ok(bytes)
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N]> {
        <[u8; N]>::try_from(self.take(N)?).map_err(|_| error!(ErrorCode::AccountDidNotDeserialize))
    }

    pub(crate) fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    pub(crate) fn u32(&mut self) -> Result<u32> {
        self.array().map(u32::from_le_bytes)
    }

    pub(crate) fn bytes(&mut self) -> Result<&'a [u8]> {
        let len = self.u32()? as usize;
        self.take(len)
    }

    pub(crate) fn option<T>(
        &mut self,
        read: impl FnOnce(&mut Self) -> Result<T>,
    ) -> Result<Option<T>> {
        match self.u8()? {
            0 => Ok(None),
            1 => read(self).map(Some),
            _ => err!(ErrorCode::AccountDidNotDeserialize),
        }
    }
}

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

// Each matcher consumes its whole encoding and evaluates only with a target.

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

    #[test]
    fn one_rule_per_instruction() {
        let rule = |selector: &[u8]| InstructionRule {
            selector: selector.to_vec(),
            data_length: None,
            account_count: None,
            accounts: vec![],
            arguments: vec![],
        };
        let program = |selectors: &[&[u8]]| {
            vec![ProgramPermission {
                program_id: Pubkey::new_unique(),
                access: ProgramAccess::Restricted(selectors.iter().map(|s| rule(s)).collect()),
            }]
        };
        assert!(validate_permissions(&program(&[&[2, 0, 0, 0], &[3, 0, 0, 0]])).is_ok());
        assert!(validate_permissions(&program(&[&[2, 0, 0, 0], &[2, 0, 0, 0]])).is_err());
        // A shorter selector would match the same instructions as a longer one.
        assert!(validate_permissions(&program(&[&[26, 1], &[26]])).is_err());
        assert!(validate_permissions(&program(&[&[26], &[26, 1]])).is_err());
    }

    #[test]
    fn one_entry_per_program() {
        let id = Pubkey::new_unique();
        let entry = |program_id| ProgramPermission {
            program_id,
            access: ProgramAccess::AllInstructions,
        };
        assert!(validate_permissions(&[entry(id), entry(Pubkey::new_unique())]).is_ok());
        assert!(validate_permissions(&[entry(id), entry(id)]).is_err());
        // The system program's all-zero id is an ordinary entry.
        assert!(
            validate_permissions(&[entry(Pubkey::default()), entry(Pubkey::default())]).is_err()
        );
    }
}
