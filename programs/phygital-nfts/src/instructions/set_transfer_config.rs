use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as SplMint;
use anchor_spl::token_2022_extensions::{token_metadata_update_field, TokenMetadataUpdateField};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_token_metadata_interface::state::{Field, TokenMetadata};

use crate::constants::PROGRAM_AUTHORITY_SEED;
use crate::error::TokenProgramError;
use crate::utils::{
    encode_optional_pubkey, fund_member_mint_rent_if_needed, token_metadata_with_transfer_config,
    ALLOWED_RECIPIENT_METADATA_KEY, PAYMENT_TOKEN_MINT_METADATA_KEY,
    PAYMENT_TOKEN_PROGRAM_METADATA_KEY, TRANSFER_PRICE_METADATA_KEY,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SetTransferConfigArgs {
    pub price: u64,
    pub payment_token_mint: Option<Pubkey>,
    pub payment_token_program: Option<Pubkey>,
    pub allowed_recipient: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct SetTransferConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub owner: Signer<'info>,

    #[account(
        mut,
        mint::token_program = token_program,
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
        constraint = owner_token_account.amount == 1,
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [PROGRAM_AUTHORITY_SEED],
        bump,
    )]
    pub program_authority: SystemAccount<'info>,

    #[account(address = token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

fn read_token_metadata(mint: &AccountInfo) -> Result<TokenMetadata> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))?;
    state
        .get_variable_len_extension::<TokenMetadata>()
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))
}

pub fn handler(ctx: Context<SetTransferConfig>, args: SetTransferConfigArgs) -> Result<()> {
    match (args.payment_token_mint, args.payment_token_program) {
        (Some(_), None) => err!(TokenProgramError::PaymentTokenProgramRequired)?,
        (None, Some(_)) => err!(TokenProgramError::PaymentTokenProgramMismatch)?,
        _ => {}
    }

    let program_authority_bump = ctx.bumps.program_authority;
    let bump_seed = [program_authority_bump];
    let authority_seed_array = [PROGRAM_AUTHORITY_SEED, &bump_seed[..]];
    let authority_seeds: &[&[u8]] = authority_seed_array.as_slice();
    let signer_seed_array = [authority_seeds];
    let signer_seeds: &[&[&[u8]]] = signer_seed_array.as_slice();

    let mint = ctx.accounts.token_mint.to_account_info();
    let current_metadata = read_token_metadata(&mint)?;
    let updated_metadata = token_metadata_with_transfer_config(
        &current_metadata,
        args.price,
        args.payment_token_mint,
        args.payment_token_program,
        args.allowed_recipient,
    );
    let metadata_size = updated_metadata
        .tlv_size_of()
        .map_err(|_| error!(TokenProgramError::ArithmeticOverflow))?;

    fund_member_mint_rent_if_needed(
        mint.clone(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        metadata_size,
    )?;

    let fields = [
        (TRANSFER_PRICE_METADATA_KEY, args.price.to_string()),
        (
            PAYMENT_TOKEN_MINT_METADATA_KEY,
            encode_optional_pubkey(args.payment_token_mint),
        ),
        (
            PAYMENT_TOKEN_PROGRAM_METADATA_KEY,
            encode_optional_pubkey(args.payment_token_program),
        ),
        (
            ALLOWED_RECIPIENT_METADATA_KEY,
            encode_optional_pubkey(args.allowed_recipient),
        ),
    ];

    let token_program_id = ctx.accounts.token_program.key();
    let token_program = ctx.accounts.token_program.to_account_info();

    for (key, value) in fields {
        token_metadata_update_field(
            CpiContext::new_with_signer(
                token_program_id,
                TokenMetadataUpdateField {
                    program_id: token_program.clone(),
                    metadata: mint.clone(),
                    update_authority: ctx.accounts.program_authority.to_account_info(),
                },
                signer_seeds,
            ),
            Field::Key(key.to_string()),
            value,
        )?;
    }

    Ok(())
}
