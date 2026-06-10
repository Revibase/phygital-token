use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::AccountMeta, program::invoke_signed, program_option::COption,
};
use anchor_lang::system_program::{transfer as system_transfer, Transfer as SystemTransfer};
use anchor_spl::associated_token::{self, AssociatedToken, Create};
use anchor_spl::token_2022::{
    close_account, set_authority,
    spl_token_2022::extension::StateWithExtensions,
    spl_token_2022::instruction::{transfer_checked as spl_transfer_checked, AuthorityType},
    spl_token_2022::state::Account as TokenAccountState,
    CloseAccount, SetAuthority,
};
use anchor_spl::token_2022_extensions::{token_metadata_update_field, TokenMetadataUpdateField};
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use sha2::{Digest, Sha256};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;
use spl_token_metadata_interface::state::Field;

use crate::constants::{PROGRAM_AUTHORITY_SEED, TRANSFER_HOOK_PROGRAM_ID};
use crate::error::TokenProgramError;
use crate::state::DomainConfig;
use crate::utils::{
    encode_last_transfer_slot, get_allowed_recipient, get_domain_config, get_group_mint,
    get_last_transfer_slot, get_payment_token_mint, get_royalty_bps, get_royalty_owner,
    get_secp256r1_pubkey, get_transfer_price, ChallengeArgs, Secp256r1VerifyArgs,
    TransferActionType, LAST_TRANSFER_SLOT_METADATA_KEY, LAST_TRANSFER_SLOT_NONE,
};

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
    /// Recipient — initiates and pays for this transaction
    #[account(mut)]
    pub recipient: Signer<'info>,

    /// Sender — does NOT need to sign. program_authority acts as permanent delegate.
    /// CHECK: validated via sender_token_account.owner
    #[account(mut)]
    pub sender: UncheckedAccount<'info>,

    #[account(mut)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Collection mint read from the NFT's TokenGroupMember extension.
    pub group_mint: Box<InterfaceAccount<'info, Mint>>,

    pub domain_config: Box<Account<'info, DomainConfig>>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
        constraint = sender_token_account.amount == 1,
        constraint = sender_token_account.owner == sender.key() @ TokenProgramError::OwnerMismatch,
    )]
    pub sender_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Recipient ATA — created in the handler; rent paid by `program_authority`.
    /// CHECK: validated and initialized via `associated_token::create_idempotent`
    #[account(mut)]
    pub recipient_token_account: UncheckedAccount<'info>,

    /// CHECK: validated against royalty_owner in group mint metadata
    #[account(mut)]
    pub group_owner: UncheckedAccount<'info>,

    /// CHECK: validated against `domain_config.authority`
    #[account(mut)]
    pub domain_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_AUTHORITY_SEED],
        bump,
    )]
    pub program_authority: SystemAccount<'info>,

    #[account(mut)]
    pub recipient_payment_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    #[account(mut)]
    pub sender_payment_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    #[account(mut)]
    pub group_owner_payment_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    #[account(mut)]
    pub domain_authority_payment_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    pub payment_token_mint: Option<Box<InterfaceAccount<'info, Mint>>>,

    /// CHECK: validated as the SlotHashes sysvar address
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// Transfer-hook program — must be in the transaction for Token-2022 hook CPI.
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

    let expected_recipient_ata = associated_token::get_associated_token_address_with_program_id(
        &ctx.accounts.recipient.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.token_program.key(),
    );
    require!(
        ctx.accounts.recipient_token_account.key() == expected_recipient_ata,
        TokenProgramError::OwnerMismatch
    );

    let parsed_group_mint = get_group_mint(&ctx.accounts.token_mint.to_account_info())?;
    require!(
        ctx.accounts.group_mint.key() == parsed_group_mint,
        TokenProgramError::GroupMintMismatch
    );

    let expected_domain_config = get_domain_config(&ctx.accounts.group_mint.to_account_info())?;
    require!(
        ctx.accounts.domain_config.key() == expected_domain_config,
        TokenProgramError::DomainConfigKeyMismatch
    );

    let royalty_owner = get_royalty_owner(&ctx.accounts.group_mint.to_account_info())?;
    require!(
        ctx.accounts.group_owner.key() == royalty_owner,
        TokenProgramError::OwnerMismatch
    );
    require!(
        ctx.accounts.domain_authority.key() == ctx.accounts.domain_config.authority,
        TokenProgramError::OwnerMismatch
    );

    if let Some(allowed) = get_allowed_recipient(&ctx.accounts.token_mint.to_account_info())? {
        require!(
            ctx.accounts.recipient.key() == allowed,
            TokenProgramError::RecipientNotAllowed
        );
    }

    let last_transfer_slot = get_last_transfer_slot(&ctx.accounts.token_mint.to_account_info())?;
    if last_transfer_slot != LAST_TRANSFER_SLOT_NONE {
        require!(
            secp256r1_verify_args.slot_number > last_transfer_slot,
            TokenProgramError::StaleTransferSlot
        );
    }

    let mut message_buffer = Vec::with_capacity(96);
    message_buffer.extend_from_slice(ctx.accounts.token_mint.key().as_ref());
    message_buffer.extend_from_slice(ctx.accounts.sender.key().as_ref());
    message_buffer.extend_from_slice(ctx.accounts.recipient.key().as_ref());
    let message_hash: [u8; 32] = Sha256::digest(&message_buffer).into();

    secp256r1_verify_args.verify_webauthn(
        &ctx.accounts.slot_hashes,
        &ctx.accounts.domain_config,
        &ctx.accounts.instructions_sysvar,
        ChallengeArgs {
            account: ctx.accounts.token_program.key(),
            message_hash,
            action_type: TransferActionType::Transfer,
        },
    )?;

    let extracted_pubkey = secp256r1_verify_args
        .extract_public_key_from_instruction(&ctx.accounts.instructions_sysvar)?;
    let expected_pubkey = get_secp256r1_pubkey(&ctx.accounts.token_mint.to_account_info())?;
    require!(
        extracted_pubkey.to_bytes() == expected_pubkey,
        TokenProgramError::Secp256r1PubkeyMismatch
    );

    if get_transfer_price(&ctx.accounts.token_mint.to_account_info())? > 0 {
        process_payment(&ctx)?;
    }

    {
        let sender_account_info = ctx.accounts.sender_token_account.to_account_info();
        let sender_data = sender_account_info.try_borrow_data()?;
        let sender_account = StateWithExtensions::<TokenAccountState>::unpack(&sender_data)
            .map_err(|_| error!(TokenProgramError::InvalidCloseAuthority))?;
        require!(
            sender_account.base.close_authority
                == COption::Some(ctx.accounts.program_authority.key()),
            TokenProgramError::InvalidCloseAuthority
        );
    }

    associated_token::create_idempotent(CpiContext::new_with_signer(
        ctx.accounts.associated_token_program.key(),
        Create {
            payer: ctx.accounts.program_authority.to_account_info(),
            associated_token: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.recipient.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        signer_seeds,
    ))?;

    let hook_program = ctx.accounts.transfer_hook_program.to_account_info();
    let mut transfer_ix = spl_transfer_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.sender_token_account.key(),
        &ctx.accounts.token_mint.key(),
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
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.recipient_token_account.to_account_info(),
            ctx.accounts.program_authority.to_account_info(),
            hook_program,
        ],
        signer_seeds,
    )?;

    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.sender_token_account.to_account_info(),
            destination: ctx.accounts.program_authority.to_account_info(),
            authority: ctx.accounts.program_authority.to_account_info(),
        },
        signer_seeds,
    ))?;

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

    let token_program_id = ctx.accounts.token_program.key();
    let token_program = ctx.accounts.token_program.to_account_info();
    token_metadata_update_field(
        CpiContext::new_with_signer(
            token_program_id,
            TokenMetadataUpdateField {
                program_id: token_program.clone(),
                metadata: ctx.accounts.token_mint.to_account_info(),
                update_authority: ctx.accounts.program_authority.to_account_info(),
            },
            signer_seeds,
        ),
        Field::Key(LAST_TRANSFER_SLOT_METADATA_KEY.to_string()),
        encode_last_transfer_slot(secp256r1_verify_args.slot_number),
    )?;

    msg!(
        "execute_transfer: {} → {} for mint {}",
        ctx.accounts.sender.key(),
        ctx.accounts.recipient.key(),
        ctx.accounts.token_mint.key(),
    );

    Ok(())
}

fn process_payment(ctx: &Context<ExecuteTransfer>) -> Result<()> {
    let price = get_transfer_price(&ctx.accounts.token_mint.to_account_info())?;
    let group_royalty_bps = get_royalty_bps(&ctx.accounts.group_mint.to_account_info())? as u64;
    let domain_royalty_bps = ctx.accounts.domain_config.royalty_bps as u64;

    let group_royalty_amount = price
        .checked_mul(group_royalty_bps)
        .ok_or(TokenProgramError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(TokenProgramError::ArithmeticOverflow)?;
    let domain_fee = group_royalty_amount
        .checked_mul(domain_royalty_bps)
        .ok_or(TokenProgramError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(TokenProgramError::ArithmeticOverflow)?;
    let group_owner_amount = group_royalty_amount
        .checked_sub(domain_fee)
        .ok_or(TokenProgramError::ArithmeticOverflow)?;
    let seller_amount = price
        .checked_sub(group_royalty_amount)
        .ok_or(TokenProgramError::ArithmeticOverflow)?;

    match get_payment_token_mint(&ctx.accounts.token_mint.to_account_info())? {
        None => {
            if domain_fee > 0 {
                system_transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.key(),
                        SystemTransfer {
                            from: ctx.accounts.recipient.to_account_info(),
                            to: ctx.accounts.domain_authority.to_account_info(),
                        },
                    ),
                    domain_fee,
                )?;
            }
            if group_owner_amount > 0 {
                system_transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.key(),
                        SystemTransfer {
                            from: ctx.accounts.recipient.to_account_info(),
                            to: ctx.accounts.group_owner.to_account_info(),
                        },
                    ),
                    group_owner_amount,
                )?;
            }
            if seller_amount > 0 {
                system_transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.key(),
                        SystemTransfer {
                            from: ctx.accounts.recipient.to_account_info(),
                            to: ctx.accounts.sender.to_account_info(),
                        },
                    ),
                    seller_amount,
                )?;
            }
        }
        Some(expected_payment_mint) => {
            let payment_mint = ctx
                .accounts
                .payment_token_mint
                .as_ref()
                .ok_or(TokenProgramError::PaymentTokenMintMismatch)?;
            require!(
                payment_mint.key() == expected_payment_mint,
                TokenProgramError::PaymentTokenMintMismatch
            );

            let recipient_ata = ctx
                .accounts
                .recipient_payment_token_account
                .as_ref()
                .ok_or(TokenProgramError::InsufficientTransferPayment)?;
            let sender_ata = ctx
                .accounts
                .sender_payment_token_account
                .as_ref()
                .ok_or(TokenProgramError::InsufficientTransferPayment)?;
            let group_owner_ata = ctx
                .accounts
                .group_owner_payment_token_account
                .as_ref()
                .ok_or(TokenProgramError::InsufficientTransferPayment)?;

            let decimals = payment_mint.decimals;

            if domain_fee > 0 {
                let domain_authority_ata = ctx
                    .accounts
                    .domain_authority_payment_token_account
                    .as_ref()
                    .ok_or(TokenProgramError::InsufficientTransferPayment)?;
                transfer_checked(
                    CpiContext::new(
                        ctx.accounts.token_program.key(),
                        TransferChecked {
                            from: recipient_ata.to_account_info(),
                            mint: payment_mint.to_account_info(),
                            to: domain_authority_ata.to_account_info(),
                            authority: ctx.accounts.recipient.to_account_info(),
                        },
                    ),
                    domain_fee,
                    decimals,
                )?;
            }

            if group_owner_amount > 0 {
                transfer_checked(
                    CpiContext::new(
                        ctx.accounts.token_program.key(),
                        TransferChecked {
                            from: recipient_ata.to_account_info(),
                            mint: payment_mint.to_account_info(),
                            to: group_owner_ata.to_account_info(),
                            authority: ctx.accounts.recipient.to_account_info(),
                        },
                    ),
                    group_owner_amount,
                    decimals,
                )?;
            }

            if seller_amount > 0 {
                transfer_checked(
                    CpiContext::new(
                        ctx.accounts.token_program.key(),
                        TransferChecked {
                            from: recipient_ata.to_account_info(),
                            mint: payment_mint.to_account_info(),
                            to: sender_ata.to_account_info(),
                            authority: ctx.accounts.recipient.to_account_info(),
                        },
                    ),
                    seller_amount,
                    decimals,
                )?;
            }
        }
    }

    Ok(())
}
