//! `verify`: proves a live tap of the accessory over a caller-chosen 32-byte
//! message, and records the sign count so the assertion cannot be reused.
//!
//! Callable through CPI: an integrating program passes its own 32-byte
//! `message_hash` and is responsible for binding freshness into it. The tap
//! signs [`build_verify_challenge`] (`message_hash` under a `verify` domain
//! tag), so it can never be accepted by another instruction, nor theirs here.

use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::state::PhygitalToken;
use crate::webauthn::challenge::build_verify_challenge;
use crate::webauthn::Secp256r1VerifyArgs;

#[derive(Accounts)]
pub struct Verify<'info> {
    #[account(mut)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl Verify<'_> {
    pub fn handler(
        ctx: Context<Self>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        message_hash: [u8; 32],
        expected_rp_id_hash: Option<[u8; 32]>,
        expected_origins: Option<Vec<String>>,
    ) -> Result<()> {
        let origin_allowed = |origin: &[u8]| {
            Ok(expected_origins
                .iter()
                .flatten()
                .any(|expected| expected.as_bytes() == origin))
        };
        let assertion = secp256r1_verify_args.verify_webauthn_assertion(
            &ctx.accounts.instructions_sysvar,
            build_verify_challenge(&message_hash),
            expected_rp_id_hash.as_ref(),
            expected_origins.is_some().then_some(&origin_allowed as _),
        )?;
        ctx.accounts
            .phygital_token
            .load_mut()?
            .accept_assertion(assertion)
    }
}
