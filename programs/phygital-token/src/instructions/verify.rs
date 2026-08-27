use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::error::PhygitalError;
use crate::state::PhygitalToken;
use crate::utils::Secp256r1VerifyArgs;

#[derive(Accounts)]
pub struct Verify<'info> {
    #[account(mut)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<Verify>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
    message_hash: [u8; 32],
    expected_rp_id: Option<String>,
    expected_origins: Option<Vec<String>>,
) -> Result<()> {
    // Generic possession proof: `message_hash` is the WebAuthn challenge as-is.
    // CPI callers that want slot freshness must fold it into `message_hash` themselves.
    let (extracted_pubkey, sign_count) = secp256r1_verify_args.verify_webauthn_assertion(
        &ctx.accounts.instructions_sysvar,
        message_hash,
        expected_rp_id.as_deref(),
        expected_origins.as_deref(),
    )?;

    let mut token = ctx.accounts.phygital_token.load_mut()?;
    require!(
        token.public_key == extracted_pubkey,
        PhygitalError::Secp256r1PubkeyMismatch
    );
    require!(
        sign_count > token.last_sign_count,
        PhygitalError::StaleSignCount
    );

    token.last_sign_count = sign_count;

    Ok(())
}
