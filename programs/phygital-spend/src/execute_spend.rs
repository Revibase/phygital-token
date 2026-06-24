use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use borsh::BorshDeserialize;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

// All phygital-token types come from the codama-generated Rust client, not the program crate.
use phygital_token_client::{
    Asset, AssetType, VerifyAssetInstructionArgs, ASSET_DISCRIMINATOR, PHYGITAL_TOKEN_ID,
    VERIFY_ASSET_DISCRIMINATOR,
};

use crate::constants::SPEND_AUTHORITY_SEED;
use crate::error::SpendError;
use crate::message::build_spend_verify_message;

#[derive(Accounts)]
pub struct ExecuteSpend<'info> {
    /// CHECK: a phygital-token `Asset`; ownership, discriminator, and fields are validated in the
    /// handler by decoding it with the generated client.
    pub asset: UncheckedAccount<'info>,

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

    /// CHECK: validated as the instructions sysvar; read to find the verify_asset instruction.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ExecuteSpend>, amount: u64) -> Result<()> {
    // Decode and validate the phygital-token asset via the generated client. The account must be
    // owned by the phygital-token program and carry the Asset discriminator.
    let asset_info = ctx.accounts.asset.to_account_info();
    require!(
        asset_info.owner.as_ref() == PHYGITAL_TOKEN_ID.as_ref(),
        SpendError::InvalidAssetAccount
    );
    let asset = {
        let data = asset_info.try_borrow_data()?;
        Asset::from_bytes(&data[..]).map_err(|_| error!(SpendError::InvalidAssetAccount))?
    };
    require!(
        asset.discriminator == ASSET_DISCRIMINATOR,
        SpendError::InvalidAssetAccount
    );

    // The passed `owner` must be the asset's owner, and the funding token account must be theirs.
    require!(
        ctx.accounts.owner.key().as_ref() == asset.owner.as_ref(),
        SpendError::OwnerMismatch
    );

    // Spending is only enabled while a Lockable asset is locked.
    require!(
        asset.asset_type == AssetType::Lockable && asset.is_locked,
        SpendError::AssetIsNotLocked
    );

    let asset_key = ctx.accounts.asset.key();
    let bump_seed = [ctx.bumps.spend_authority];
    let authority_seed_array = [SPEND_AUTHORITY_SEED, asset_key.as_ref(), &bump_seed[..]];
    let authority_seeds: &[&[u8]] = authority_seed_array.as_slice();
    let signer_seed_array = [authority_seeds];
    let signer_seeds: &[&[&[u8]]] = signer_seed_array.as_slice();

    // Budget is enforced by SPL: the owner must have approved this asset's spend_authority and the
    // requested amount must fit within the live delegated_amount.
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

    // WebAuthn verification is delegated to phygital_token::verify_asset. Require that a
    // verify_asset for THIS asset, bound to recipient|mint|amount, ran earlier in this transaction.
    // Since instructions execute in order and the tx aborts on any failure, reaching this point
    // means that verify_asset succeeded (passkey verified, freshness/replay enforced there).
    let expected_message =
        build_spend_verify_message(&ctx.accounts.recipient.key(), &ctx.accounts.mint.key(), amount);
    require_matching_verify_asset(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &asset_key,
        expected_message.as_slice(),
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

    Ok(())
}

/// Scans the instructions sysvar for a `phygital_token::verify_asset` instruction that ran before
/// this one in the same transaction, references `asset` as its first account, and carries
/// `expected_message`. Returns `MissingVerifyAsset` if none matches.
///
/// Uses the generated client's program id, discriminator, and args decoder. All cross-crate
/// pubkey comparisons go through raw bytes so the client's solana-crate versions need not match
/// this program's exactly.
fn require_matching_verify_asset(
    instructions_sysvar: &AccountInfo,
    asset: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_index = load_current_index_checked(instructions_sysvar)? as usize;
    for i in 0..current_index {
        let ix = load_instruction_at_checked(i, instructions_sysvar)?;
        if ix.program_id.as_ref() != PHYGITAL_TOKEN_ID.as_ref() {
            continue;
        }
        if !ix.data.starts_with(&VERIFY_ASSET_DISCRIMINATOR) {
            continue;
        }
        // verify_asset accounts: [asset, slot_hashes, instructions_sysvar]
        let Some(meta) = ix.accounts.first() else {
            continue;
        };
        if meta.pubkey.as_ref() != asset.as_ref() {
            continue;
        }
        let args_data = &ix.data[VERIFY_ASSET_DISCRIMINATOR.len()..];
        if let Ok(args) = VerifyAssetInstructionArgs::try_from_slice(args_data) {
            if args.message.as_slice() == expected_message {
                return Ok(());
            }
        }
    }
    Err(error!(SpendError::MissingVerifyAsset))
}
