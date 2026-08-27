use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::error::PhygitalError;
use crate::state::PhygitalToken;
use crate::utils::Secp256r1VerifyArgs;
use crate::Secp256r1Pubkey;

#[event]
pub struct VerifyEvent {
    pub message_hash: [u8; 32],
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub time: i64,
}

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Secp256r1VerifyArgs)]
pub struct Verify<'info> {
    #[account(
        mut,
        constraint = {
            let extracted_pubkey = secp256r1_verify_args.extract_public_key_from_instruction(&instructions_sysvar)?;
            phygital_token.public_key == extracted_pubkey
        } @ PhygitalError::Secp256r1PubkeyMismatch,
    )]
    pub phygital_token: Account<'info, PhygitalToken>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<Verify>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
    message_hash: [u8; 32],
    expected_rp_id: Option<String>,
    expected_origin: Option<String>,
) -> Result<()> {
    let sign_count = secp256r1_verify_args.extract_sign_count(&ctx.accounts.instructions_sysvar)?;
    require!(
        sign_count > ctx.accounts.phygital_token.last_sign_count,
        PhygitalError::StaleSignCount
    );

    // Generic possession proof: `message_hash` is the WebAuthn challenge as-is.
    // CPI callers that want slot freshness must fold it into `message_hash` themselves.
    secp256r1_verify_args.verify_webauthn(&ctx.accounts.instructions_sysvar, message_hash)?;

    secp256r1_verify_args.verify_optional_webauthn_bindings(
        &ctx.accounts.instructions_sysvar,
        expected_rp_id.as_deref(),
        expected_origin.as_deref(),
    )?;

    ctx.accounts.phygital_token.last_sign_count = sign_count;

    emit!(VerifyEvent {
        message_hash,
        owner: ctx.accounts.phygital_token.owner,
        identifier: ctx.accounts.phygital_token.identifier,
        public_key: ctx.accounts.phygital_token.public_key,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
