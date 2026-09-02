use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::error::PhygitalError;
use crate::state::PhygitalToken;
use crate::utils::{build_transfer_challenge, Secp256r1VerifyArgs};
use crate::{PhygitalTokenType, Secp256r1Pubkey};

#[event]
pub struct TransferEvent {
    pub recipient: Pubkey,
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
}

#[derive(Accounts)]
pub struct TransferOwnership<'info> {
    pub recipient: Signer<'info>,

    #[account(mut)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// CHECK: validated as the SlotHashes sysvar address
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<TransferOwnership>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
    slot_number: u64,
) -> Result<()> {
    let mut token = ctx.accounts.phygital_token.load_mut()?;

    if token.token_type == PhygitalTokenType::Controlled as u8 {
        require!(token.is_locked == 0, PhygitalError::TokenIsCurrentlyLocked);
        token.is_locked = 1;
    }

    let slot_hash = Secp256r1VerifyArgs::fetch_slot_hash(&ctx.accounts.slot_hashes, slot_number)?;
    let expected_challenge =
        build_transfer_challenge(&ctx.accounts.phygital_token.key(), slot_hash);

    let (extracted_pubkey, sign_count) = secp256r1_verify_args.verify_webauthn_assertion(
        &ctx.accounts.instructions_sysvar,
        expected_challenge,
        None,
        None,
    )?;

    require!(
        token.public_key == extracted_pubkey,
        PhygitalError::Secp256r1PubkeyMismatch
    );
    require!(
        sign_count > token.last_sign_count,
        PhygitalError::StaleSignCount
    );

    emit!(TransferEvent {
        owner: token.owner,
        recipient: ctx.accounts.recipient.key(),
        public_key: token.public_key,
        identifier: token.identifier,
    });

    token.last_sign_count = sign_count;
    token.owner = ctx.accounts.recipient.key();

    Ok(())
}
