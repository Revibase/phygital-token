use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::AccountMeta, program::invoke_signed};
use anchor_spl::associated_token::{self, AssociatedToken, Create};
use anchor_spl::token_2022::{
    close_account, set_authority,
    spl_token_2022::instruction::{transfer_checked as spl_transfer_checked, AuthorityType},
    CloseAccount, SetAuthority,
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::constants::{PROGRAM_AUTHORITY_SEED, TRANSFER_HOOK_PROGRAM_ID};
use crate::error::PhygitalError;
use crate::state::{find_asset_pda, Asset, LAST_TRANSFER_SLOT_NONE};
use crate::utils::{build_transfer_message_hash, ActionType, ChallengeArgs, Secp256r1VerifyArgs};
use crate::{AssetType, Secp256r1Pubkey};

#[event]
pub struct TransferEvent {
    pub recipient: Pubkey,
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub mint: Pubkey,
    pub origin: String,
    pub time: i64,
}

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Secp256r1VerifyArgs)]
pub struct ExecuteTransfer<'info> {
    pub recipient: Signer<'info>,

    /// CHECK: sender does not sign; validated against asset.owner and sender_token_account.owner
    #[account(
        constraint = sender.key() == asset.owner @ PhygitalError::OwnerMismatch,
    )]
    pub sender: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = {
            let extracted_pubkey = secp256r1_verify_args.extract_public_key_from_instruction(&instructions_sysvar)?;
            let expected_pda = find_asset_pda(&extracted_pubkey);
            asset.key() == expected_pda
        } @ PhygitalError::Secp256r1PubkeyMismatch,
    )]
    pub asset: Account<'info, Asset>,

    #[account(
        mut,
        constraint = asset.mint == mint.key(),
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = sender_token_account.amount >= 1,
        constraint = sender_token_account.owner == sender.key() @ PhygitalError::OwnerMismatch,
        constraint = sender_token_account.mint == mint.key(),
    )]
    pub sender_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated and initialized via `associated_token::create_idempotent`
    #[account(mut)]
    pub recipient_token_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_AUTHORITY_SEED],
        bump,
    )]
    pub program_authority: SystemAccount<'info>,

    /// CHECK: validated as the SlotHashes sysvar address
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    #[account(
        address = anchor_spl::token_2022::ID
    )]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// CHECK: constrained to this program's id
    #[account(address = TRANSFER_HOOK_PROGRAM_ID)]
    pub transfer_hook_program: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<ExecuteTransfer>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
) -> Result<()> {
    let program_authority_bump = ctx.bumps.program_authority;
    let bump_seed = [program_authority_bump];
    let authority_seed_array = [PROGRAM_AUTHORITY_SEED, &bump_seed[..]];
    let authority_seeds: &[&[u8]] = authority_seed_array.as_slice();
    let signer_seed_array = [authority_seeds];
    let signer_seeds: &[&[&[u8]]] = signer_seed_array.as_slice();

    let last_transfer_slot = ctx.accounts.asset.last_transfer_slot;
    if last_transfer_slot != LAST_TRANSFER_SLOT_NONE {
        require!(
            secp256r1_verify_args.slot_number > last_transfer_slot,
            PhygitalError::StaleTransferSlot
        );
    }

    require!(
        ctx.accounts.recipient.key() != ctx.accounts.program_authority.key(),
        PhygitalError::InvalidRecipient
    );

    if ctx.accounts.asset.asset_type == AssetType::Configurable {
        require!(
            !ctx.accounts.asset.is_locked,
            PhygitalError::AssetIsCurrentlyLocked
        );
        ctx.accounts.asset.is_locked = true
    }

    let message_hash = build_transfer_message_hash(&ctx.accounts.sender.key());

    secp256r1_verify_args.verify_webauthn(
        &ctx.accounts.slot_hashes,
        &ctx.accounts.instructions_sysvar,
        ChallengeArgs {
            message_hash,
            action_type: ActionType::Transfer,
        },
    )?;

    associated_token::create_idempotent(CpiContext::new_with_signer(
        ctx.accounts.associated_token_program.key(),
        Create {
            payer: ctx.accounts.program_authority.to_account_info(),
            associated_token: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.recipient.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        signer_seeds,
    ))?;

    let closing_sender_ata = ctx.accounts.sender_token_account.amount == 1;

    let hook_program = ctx.accounts.transfer_hook_program.to_account_info();
    let mut transfer_ix = spl_transfer_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.sender_token_account.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.recipient_token_account.key(),
        &ctx.accounts.program_authority.key(),
        &[],
        1,
        0,
    )?;
    transfer_ix.accounts.push(AccountMeta::new_readonly(
        ctx.accounts.transfer_hook_program.key(),
        false,
    ));

    invoke_signed(
        &transfer_ix,
        &[
            ctx.accounts.sender_token_account.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.recipient_token_account.to_account_info(),
            ctx.accounts.program_authority.to_account_info(),
            hook_program,
        ],
        signer_seeds,
    )?;

    ctx.accounts.asset.last_transfer_slot = secp256r1_verify_args.slot_number;
    ctx.accounts.asset.owner = ctx.accounts.recipient.key();

    if closing_sender_ata {
        close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.sender_token_account.to_account_info(),
                destination: ctx.accounts.program_authority.to_account_info(),
                authority: ctx.accounts.program_authority.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    set_authority(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            SetAuthority {
                account_or_mint: ctx.accounts.recipient_token_account.to_account_info(),
                current_authority: ctx.accounts.recipient.to_account_info(),
            },
        ),
        AuthorityType::CloseAccount,
        Some(ctx.accounts.program_authority.key()),
    )?;

    emit!(TransferEvent {
        owner: ctx.accounts.sender.key(),
        recipient: ctx.accounts.recipient.key(),
        mint: ctx.accounts.mint.key(),
        public_key: ctx.accounts.asset.public_key,
        origin: secp256r1_verify_args.origin,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
