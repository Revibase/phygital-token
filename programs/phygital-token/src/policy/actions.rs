//! `update_policy`'s edits and the validation applied to the result.

use anchor_lang::prelude::*;

use super::caps::CapArg;
use super::permissions::{validate_permissions, ProgramPermission};
use crate::constants::is_wsol_mint;
use crate::error::PhygitalError;
use crate::state::{AccessoryPolicy, MintCap, SpendCap};

/// One edit to a policy. Edits apply in order; the resulting program
/// permissions are validated once at the end.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum PolicyAction {
    SetSolCap(Option<CapArg>),
    SetMintCap(Pubkey, CapArg),
    RemoveMintCap(Pubkey),
    SetAllowedOrigins(Vec<String>),
    SetProgramPermission(ProgramPermission),
    RemoveProgramPermission(Pubkey),
}

impl AccessoryPolicy {
    pub fn apply(&mut self, actions: Vec<PolicyAction>, now: i64) -> Result<()> {
        for action in actions {
            match action {
                PolicyAction::SetSolCap(arg) => {
                    self.sol_cap = match arg {
                        Some(arg) => Some(SpendCap::new(&arg, now)?.keep_usage(self.sol_cap)),
                        None => None,
                    }
                }
                PolicyAction::SetMintCap(mint, arg) => {
                    require!(
                        mint != Pubkey::default() && !is_wsol_mint(&mint),
                        PhygitalError::InvalidPolicyArgs
                    );
                    let new = SpendCap::new(&arg, now)?;
                    match self.mint_caps.iter_mut().find(|m| m.mint == mint) {
                        Some(existing) => existing.cap = new.keep_usage(Some(existing.cap)),
                        None => self.mint_caps.push(MintCap { mint, cap: new }),
                    }
                }
                PolicyAction::RemoveMintCap(mint) => {
                    let len = self.mint_caps.len();
                    self.mint_caps.retain(|m| m.mint != mint);
                    require!(self.mint_caps.len() < len, PhygitalError::InvalidPolicyArgs);
                }
                PolicyAction::SetAllowedOrigins(origins) => {
                    for (i, origin) in origins.iter().enumerate() {
                        require!(
                            is_valid_origin(origin) && !origins[..i].contains(origin),
                            PhygitalError::InvalidPolicyArgs
                        );
                    }
                    self.allowed_origins = origins;
                }
                PolicyAction::SetProgramPermission(permission) => {
                    match self
                        .program_permissions
                        .iter_mut()
                        .find(|p| p.program_id == permission.program_id)
                    {
                        Some(existing) => *existing = permission,
                        None => self.program_permissions.push(permission),
                    }
                }
                PolicyAction::RemoveProgramPermission(program_id) => {
                    let len = self.program_permissions.len();
                    self.program_permissions
                        .retain(|p| p.program_id != program_id);
                    require!(
                        self.program_permissions.len() < len,
                        PhygitalError::InvalidPolicyArgs
                    );
                }
            }
        }
        validate_permissions(&self.program_permissions)
    }
}

/// The exact form browsers write: no path, trailing slash or uppercase.
fn is_valid_origin(origin: &str) -> bool {
    let host = match origin.strip_prefix("https://") {
        Some(host) => host,
        None => match origin.strip_prefix("http://") {
            Some(host) if host == "localhost" || host.starts_with("localhost:") => host,
            _ => return false,
        },
    };
    let (name, port) = match host.split_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (host, None),
    };
    !name.is_empty()
        && !name.starts_with(['.', '-'])
        && !name.ends_with(['.', '-'])
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && port
            .is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()))
}
