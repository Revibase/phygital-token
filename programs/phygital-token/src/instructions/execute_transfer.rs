use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::error::PhygitalError;
use crate::state::Asset;
use crate::utils::{build_transfer_challenge, Secp256r1VerifyArgs};
use crate::{AssetType, Secp256r1Pubkey};

#[event]
pub struct TransferEvent {
    pub recipient: Pubkey,
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub time: i64,
}

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Secp256r1VerifyArgs, slot_number: u64)]
pub struct ExecuteTransfer<'info> {
    /// CHECK: recipient does not sign; can be any wallet address except default pubkey;
    #[account(
        constraint = recipient.key() != Pubkey::default() @ PhygitalError::InvalidRecipient,
    )]
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = {
            let extracted_pubkey = secp256r1_verify_args.extract_public_key_from_instruction(&instructions_sysvar)?;
            asset.public_key == extracted_pubkey
        } @ PhygitalError::Secp256r1PubkeyMismatch,
    )]
    pub asset: Account<'info, Asset>,

    /// CHECK: validated as the SlotHashes sysvar address
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<ExecuteTransfer>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
    slot_number: u64,
) -> Result<()> {
    let sign_count =
        secp256r1_verify_args.extract_sign_count(&ctx.accounts.instructions_sysvar)?;
    require!(
        sign_count > ctx.accounts.asset.last_sign_count,
        PhygitalError::StaleSignCount
    );

    if ctx.accounts.asset.asset_type == AssetType::Lockable {
        require!(
            !ctx.accounts.asset.is_locked,
            PhygitalError::AssetIsCurrentlyLocked
        );
        if ctx.accounts.asset.owner == Pubkey::default() {
            ctx.accounts.asset.is_locked = true;
        }
    }

    let slot_hash =
        Secp256r1VerifyArgs::fetch_slot_hash(&ctx.accounts.slot_hashes, slot_number)?;
    let expected_challenge = build_transfer_challenge(&ctx.accounts.asset.key(), slot_hash);

    secp256r1_verify_args
        .verify_webauthn(&ctx.accounts.instructions_sysvar, expected_challenge)?;

    emit!(TransferEvent {
        owner: ctx.accounts.asset.owner.key(),
        recipient: ctx.accounts.recipient.key(),
        public_key: ctx.accounts.asset.public_key,
        identifier: ctx.accounts.asset.identifier,
        time: Clock::get()?.unix_timestamp,
    });

    ctx.accounts.asset.last_sign_count = sign_count;
    ctx.accounts.asset.owner = ctx.accounts.recipient.key();

    Ok(())
}
