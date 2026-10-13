//! Which programs and instructions the accessory may call, and the
//! validation of those rules when the owner saves them.
//!
//! A program absent from the list is blocked. A listed program either allows
//! every instruction or only those matching one of its rules. A rule matches
//! by data prefix (`selector`) and may constrain the data length, the account
//! count, individual accounts (key, owning program, signer and writable flags,
//! account data) and numeric or byte arguments in the instruction data.
//!
//! These types are stored Borsh-encoded in the policy account and matched in
//! place by [`super::matcher`]; changing their shape changes the account layout.

use anchor_lang::prelude::*;

use crate::error::PhygitalError;

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
    pub(super) fn bytes(self) -> usize {
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

#[cfg(test)]
mod tests {
    use super::*;

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
