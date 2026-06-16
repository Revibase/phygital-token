use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::{self, AssociatedToken, Create};
use anchor_spl::token_2022::{
    self, mint_to, MintTo,
};
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::{CARD_INSTANCE_SEED, PROGRAM_AUTHORITY_SEED};
use crate::error::PhygitalError;
use crate::state::CardInstance;
use crate::utils::{mint_token_account_rent, secp256r1_pda_seed};
use crate::Secp256r1Pubkey;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct MintTokenArgs {
    pub secp256r1_pubkey: Secp256r1Pubkey,
}

#[derive(Accounts)]
#[instruction(args: MintTokenArgs)]
pub struct MintToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + CardInstance::INIT_SPACE,
        seeds = [CARD_INSTANCE_SEED, secp256r1_pda_seed(&args.secp256r1_pubkey)],
        bump,
    )]
    pub card_instance: Account<'info, CardInstance>,

    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [PROGRAM_AUTHORITY_SEED],
        bump,
    )]
    pub program_authority: SystemAccount<'info>,

    /// CHECK: validated and initialized via associated_token::create_idempotent
    #[account(mut)]
    pub program_authority_token_account: UncheckedAccount<'info>,

    #[account(
        address = token_2022::ID
    )]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MintToken>, _args: MintTokenArgs) -> Result<()> {

    #[cfg(feature = "mainnet")]
    require!(ctx.accounts.authority.key() == crate::ADMIN, PhygitalError::AuthorityMismatch);

    let mint_key = ctx.accounts.mint.key();
    let mint_info = ctx.accounts.mint.to_account_info();
  
    ctx.accounts.card_instance.init(
        mint_key,
        ctx.accounts.program_authority.key(),
    );

    let program_authority_bump = ctx.bumps.program_authority;
    let bump_seed = [program_authority_bump];
    let authority_seed_array = [PROGRAM_AUTHORITY_SEED, bump_seed.as_ref()];
    let authority_seeds: &[&[u8]] = authority_seed_array.as_slice();
    let signer_seed_array = [authority_seeds];
    let signer_seeds: &[&[&[u8]]] = signer_seed_array.as_slice();

    let token_program_id = ctx.accounts.token_program.key();
    let mint = mint_info;
    let program_authority = ctx.accounts.program_authority.to_account_info();

    let expected_custody_ata = associated_token::get_associated_token_address_with_program_id(
        &ctx.accounts.program_authority.key(),
        &mint_key,
        &token_program_id,
    );
    require_keys_eq!(
        ctx.accounts.program_authority_token_account.key(),
        expected_custody_ata,
        PhygitalError::InvalidCustodyTokenAccount,
    );

    let custody_ata = ctx
        .accounts
        .program_authority_token_account
        .to_account_info();
    let custody_ata_exists =
        custody_ata.owner == &token_program_id && !custody_ata.data_is_empty();
    let token_account_rent = mint_token_account_rent()?;

    if custody_ata_exists {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: program_authority.clone(),
                },
            ),
            token_account_rent,
        )?;
    } else {
        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.key(),
            Create {
                payer: ctx.accounts.authority.to_account_info(),
                associated_token: custody_ata,
                authority: program_authority.clone(),
                mint: mint.clone(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
    }

    mint_to(
        CpiContext::new_with_signer(
            token_program_id,
            MintTo {
                mint: mint.clone(),
                to: ctx
                    .accounts
                    .program_authority_token_account
                    .to_account_info(),
                authority: program_authority.clone(),
            },
            signer_seeds,
        ),
        1,
    )?;

    Ok(())
}
