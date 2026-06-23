use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::constants::SPEND_AUTHORITY_SEED;
use crate::error::PhygitalError;
use crate::state::{find_asset_pda, Asset, LAST_TRANSFER_SLOT_NONE};
use crate::utils::{build_spend_message_hash, ActionType, ChallengeArgs, Secp256r1VerifyArgs};
use crate::{AssetType, Secp256r1Pubkey};

#[event]
pub struct SpendEvent {
    pub public_key: Secp256r1Pubkey,
    pub owner: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub remaining: u64,
    pub time: i64,
}

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Secp256r1VerifyArgs)]
pub struct ExecuteSpend<'info> {
    #[account(
        mut,
        constraint = {
            let extracted_pubkey = secp256r1_verify_args.extract_public_key_from_instruction(&instructions_sysvar)?;
            let expected_pda = find_asset_pda(&extracted_pubkey);
            asset.key() == expected_pda
        } @ PhygitalError::Secp256r1PubkeyMismatch,
    )]
    pub asset: Account<'info, Asset>,

    /// CHECK: owner does not sign; validated against asset.owner and owner_token_account.owner
    #[account(
        constraint = owner.key() == asset.owner @ PhygitalError::OwnerMismatch,
    )]
    pub owner: UncheckedAccount<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = owner_token_account.owner == asset.owner @ PhygitalError::OwnerMismatch,
        constraint = owner_token_account.mint == mint.key() @ PhygitalError::SpendMintMismatch,
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: recipient does not sign; validated against recipient_token_account.owner
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == recipient.key() @ PhygitalError::RecipientMismatch,
        constraint = recipient_token_account.mint == mint.key() @ PhygitalError::SpendMintMismatch,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Per-asset SPL delegate the owner approved; signs the delegated transfer.
    #[account(
        seeds = [SPEND_AUTHORITY_SEED, asset.key().as_ref()],
        bump,
    )]
    pub spend_authority: SystemAccount<'info>,

    /// CHECK: validated as the SlotHashes sysvar address
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ExecuteSpend>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
    amount: u64,
) -> Result<()> {
    let spend_authority_bump = ctx.bumps.spend_authority;
    let asset_key = ctx.accounts.asset.key();
    let bump_seed = [spend_authority_bump];
    let authority_seed_array = [SPEND_AUTHORITY_SEED, asset_key.as_ref(), &bump_seed[..]];
    let authority_seeds: &[&[u8]] = authority_seed_array.as_slice();
    let signer_seed_array = [authority_seeds];
    let signer_seeds: &[&[&[u8]]] = signer_seed_array.as_slice();

    // Spending is only enabled while a Lockable asset is locked.
    require!(
        ctx.accounts.asset.asset_type == AssetType::Lockable && ctx.accounts.asset.is_locked,
        PhygitalError::AssetIsNotLocked
    );

    // Replay guard reuses the asset's monotonic transfer slot (shared nonce across
    // transfer / verify / spend).
    let last_slot = ctx.accounts.asset.last_transfer_slot;
    if last_slot != LAST_TRANSFER_SLOT_NONE {
        require!(
            secp256r1_verify_args.slot_number > last_slot,
            PhygitalError::StaleSpendSlot
        );
    }

    // Budget is enforced by SPL: the owner must have approved this asset's spend_authority and
    // the requested amount must fit within the live delegated_amount.
    require!(
        ctx.accounts.owner_token_account.delegate
            == COption::Some(ctx.accounts.spend_authority.key()),
        PhygitalError::SpendDelegateMismatch
    );
    let delegated_amount = ctx.accounts.owner_token_account.delegated_amount;
    require!(amount > 0, PhygitalError::SpendAmountZero);
    require!(
        amount <= delegated_amount,
        PhygitalError::InsufficientSpendAllowance
    );
    require!(
        ctx.accounts.recipient.key() != ctx.accounts.spend_authority.key()
            && ctx.accounts.recipient.key() != ctx.accounts.owner.key(),
        PhygitalError::InvalidSpendRecipient
    );

    // The challenge binds recipient + mint + amount so a captured signature can't be redirected.
    let message_hash = build_spend_message_hash(
        &ctx.accounts.recipient.key(),
        &ctx.accounts.mint.key(),
        amount,
    );
    secp256r1_verify_args.verify_webauthn(
        &ctx.accounts.slot_hashes,
        &ctx.accounts.instructions_sysvar,
        ChallengeArgs {
            message_hash,
            action_type: ActionType::Spend,
        },
    )?;

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.owner_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.spend_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.asset.last_transfer_slot = secp256r1_verify_args.slot_number;

    emit!(SpendEvent {
        public_key: ctx.accounts.asset.public_key,
        owner: ctx.accounts.owner.key(),
        recipient: ctx.accounts.recipient.key(),
        mint: ctx.accounts.mint.key(),
        amount,
        remaining: delegated_amount - amount,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
