use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::error::PhygitalError;
use crate::state::{find_asset_pda, Asset, LAST_TRANSFER_SLOT_NONE};
use crate::utils::{ActionType, ChallengeArgs, Secp256r1VerifyArgs};
use crate::{build_verify_message_hash, Secp256r1Pubkey};

#[event]
pub struct VerifyAssetEvent {
    pub message: String,
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub mint: Pubkey,
    pub origin: String,
    pub time: i64,
}

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Secp256r1VerifyArgs)]
pub struct VerifyAsset<'info> {
    #[account(
        mut,
        constraint = {
            let extracted_pubkey = secp256r1_verify_args.extract_public_key_from_instruction(&instructions_sysvar)?;
            let expected_pda = find_asset_pda(&extracted_pubkey);
            asset.key() == expected_pda
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
    ctx: Context<VerifyAsset>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
    message: String,
) -> Result<()> {
    let last_transfer_slot = ctx.accounts.asset.last_transfer_slot;
    if last_transfer_slot != LAST_TRANSFER_SLOT_NONE {
        require!(
            secp256r1_verify_args.slot_number > last_transfer_slot,
            PhygitalError::StaleTransferSlot
        );
    }

    let message_hash = build_verify_message_hash(&message);

    secp256r1_verify_args.verify_webauthn(
        &ctx.accounts.slot_hashes,
        &ctx.accounts.instructions_sysvar,
        ChallengeArgs {
            message_hash,
            action_type: ActionType::Verify,
        },
    )?;

    ctx.accounts.asset.last_transfer_slot = secp256r1_verify_args.slot_number;

    emit!(VerifyAssetEvent {
        message: message.clone(),
        owner: ctx.accounts.asset.owner,
        mint: ctx.accounts.asset.mint,
        public_key: ctx.accounts.asset.public_key,
        origin: secp256r1_verify_args.origin,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
