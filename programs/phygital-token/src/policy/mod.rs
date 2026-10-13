//! The owner's policy over the accessory wallet: editing it, validating it and
//! checking executes against it. The account itself is
//! [`crate::state::AccessoryPolicy`].

mod actions;
mod caps;
mod matcher;
mod permissions;
mod reader;
mod view;

use anchor_lang::prelude::*;

pub use actions::PolicyAction;
pub use caps::CapArg;
pub(crate) use matcher::check_instruction;
pub use permissions::{
    AccountConstraint, AccountKeyConstraint, Comparison, DataConstraint, DataPredicate,
    InstructionRule, NumericWidth, ProgramAccess, ProgramPermission,
};
pub(crate) use view::PolicyView;

/// Closes the token's policy, if one exists, sending its rent to `receiver`.
///
/// Every instruction that changes `phygital_token.owner` must call this, so a
/// new owner never inherits the previous owner's grants.
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
