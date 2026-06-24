use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use phygital_token_client::{
    Asset, AssetType, Secp256r1VerifyArgs, VerifyAssetCpi, VerifyAssetCpiAccounts,
    VerifyAssetInstructionArgs, PHYGITAL_TOKEN_ID,
};

use crate::constants::SPEND_AUTHORITY_SEED;
use crate::error::SpendError;
use crate::message::build_spend_verify_message;

#[derive(Accounts)]
pub struct ExecuteSpend<'info> {
    #[account(
        mut,
        constraint = asset.owner == owner.key() @SpendError::OwnerMismatch,
        constraint = asset.asset_type == AssetType::Lockable && asset.is_locked @SpendError::AssetIsNotLocked
    )]
    pub asset: Account<'info, Asset>,

    /// CHECK: does not sign; validated against the decoded asset's owner in the handler.
    pub owner: UncheckedAccount<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key() @ SpendError::OwnerMismatch,
        constraint = owner_token_account.mint == mint.key() @ SpendError::SpendMintMismatch,
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: does not sign; validated against recipient_token_account.owner
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == recipient.key() @ SpendError::RecipientMismatch,
        constraint = recipient_token_account.mint == mint.key() @ SpendError::SpendMintMismatch,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Per-asset SPL delegate (this program's PDA) the owner approved; signs the delegated transfer.
    #[account(
        seeds = [SPEND_AUTHORITY_SEED, asset.key().as_ref()],
        bump,
    )]
    pub spend_authority: SystemAccount<'info>,

    /// CHECK: validated as the phygital-token program id; target of the verify_asset CPI.
    #[account(
        address = PHYGITAL_TOKEN_ID
    )]
    pub phygital_token_program: UncheckedAccount<'info>,

    /// CHECK: validated as the SlotHashes sysvar; forwarded to verify_asset.
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar; forwarded to verify_asset.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(
    ctx: Context<ExecuteSpend>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
    amount: u64,
) -> Result<()> {
    let asset_key = ctx.accounts.asset.key();
    let bump_seed = [ctx.bumps.spend_authority];
    let authority_seed_array = [SPEND_AUTHORITY_SEED, asset_key.as_ref(), &bump_seed[..]];
    let authority_seeds: &[&[u8]] = authority_seed_array.as_slice();
    let signer_seed_array = [authority_seeds];
    let signer_seeds: &[&[&[u8]]] = signer_seed_array.as_slice();

    require!(amount > 0, SpendError::SpendAmountZero);
    require!(
        ctx.accounts.owner_token_account.delegate
            == COption::Some(ctx.accounts.spend_authority.key()),
        SpendError::SpendDelegateMismatch
    );
    let delegated_amount = ctx.accounts.owner_token_account.delegated_amount;
    require!(
        amount <= delegated_amount,
        SpendError::InsufficientSpendAllowance
    );
    require!(
        ctx.accounts.recipient.key() != ctx.accounts.spend_authority.key()
            && ctx.accounts.recipient.key() != ctx.accounts.owner.key(),
        SpendError::InvalidSpendRecipient
    );

    let message = build_spend_verify_message(
        &ctx.accounts.recipient.key(),
        &ctx.accounts.mint.key(),
        amount,
    );

    // WebAuthn verification is delegated to phygital_token::verify_asset via CPI. The transaction
    // must include a matching secp256r1 verify instruction earlier in the same transaction.
    VerifyAssetCpi::new(
        &ctx.accounts.phygital_token_program.to_account_info(),
        VerifyAssetCpiAccounts {
            asset: &ctx.accounts.asset.to_account_info(),
            slot_hashes: &ctx.accounts.slot_hashes.to_account_info(),
            instructions_sysvar: &ctx.accounts.instructions_sysvar.to_account_info(),
        },
        VerifyAssetInstructionArgs {
            secp256r1_verify_args,
            message,
        },
    )
    .invoke()
    .map_err(|e| anchor_lang::error::Error::from(anchor_lang::prelude::ProgramError::from(e)))?;

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

    Ok(())
}
