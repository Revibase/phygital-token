use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::error::PhygitalError;
use crate::state::Asset;
use crate::utils::Secp256r1VerifyArgs;
use crate::Secp256r1Pubkey;

#[event]
pub struct VerifyAssetEvent {
    pub message_hash: [u8; 32],
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub time: i64,
}

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Secp256r1VerifyArgs)]
pub struct VerifyAsset<'info> {
    #[account(
        mut,
        constraint = {
            let extracted_pubkey = secp256r1_verify_args.extract_public_key_from_instruction(&instructions_sysvar)?;
            asset.public_key == extracted_pubkey
        } @ PhygitalError::Secp256r1PubkeyMismatch,
    )]
    pub asset: Account<'info, Asset>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<VerifyAsset>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
    message_hash: [u8; 32],
    expected_rp_id: Option<String>,
    expected_origin: Option<String>,
) -> Result<()> {
    let sign_count =
        secp256r1_verify_args.extract_sign_count(&ctx.accounts.instructions_sysvar)?;
    require!(
        sign_count > ctx.accounts.asset.last_sign_count,
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

    ctx.accounts.asset.last_sign_count = sign_count;

    emit!(VerifyAssetEvent {
        message_hash,
        owner: ctx.accounts.asset.owner,
        identifier: ctx.accounts.asset.identifier,
        public_key: ctx.accounts.asset.public_key,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
