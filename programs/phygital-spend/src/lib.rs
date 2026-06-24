use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod execute_spend;
pub mod message;

pub use constants::*;
pub use error::*;
pub use execute_spend::*;
pub use message::*;

declare_id!("Gkst75NEFq6ojS9s9MCKtKcmEbGVL3SkcFxm3eVysxRF");

#[program]
pub mod phygital_spend {
    use super::*;

    /// Spends `amount` of the delegated SPL token from the asset owner's wallet to `recipient`.
    ///
    /// WebAuthn verification is NOT performed here — it is delegated to
    /// `phygital_token::verify_asset`. This instruction requires that the same transaction already
    /// contains a `verify_asset` for the same `asset`, whose message binds `recipient | mint |
    /// amount` (see [`build_spend_verify_message`]). The owner must have approved this program's
    /// per-asset `spend_authority` PDA as the SPL delegate.
    pub fn execute_spend(ctx: Context<ExecuteSpend>, amount: u64) -> Result<()> {
        execute_spend::handler(ctx, amount)
    }
}
