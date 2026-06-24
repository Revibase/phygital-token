use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod execute_spend;
pub mod message;

pub use constants::*;
pub use error::*;
pub use execute_spend::*;
pub use message::*;

pub use phygital_token_client::Secp256r1VerifyArgs;

declare_id!("Gkst75NEFq6ojS9s9MCKtKcmEbGVL3SkcFxm3eVysxRF");

#[program]
pub mod phygital_spend {

    use super::*;

    /// Spends `amount` of the delegated SPL token from the asset owner's wallet to `recipient`.
    ///
    /// WebAuthn verification is performed via CPI to `phygital_token::verify_asset`, binding the
    /// spend to `recipient | mint | amount` (see [`build_spend_verify_message`]). The transaction
    /// must include a matching secp256r1 verify instruction earlier in the same transaction.
    /// The owner must have approved this program's per-asset `spend_authority` PDA as the SPL delegate.
    pub fn execute_spend(
        ctx: Context<ExecuteSpend>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        amount: u64,
    ) -> Result<()> {
        execute_spend::handler(ctx, secp256r1_verify_args, amount)
    }
}
