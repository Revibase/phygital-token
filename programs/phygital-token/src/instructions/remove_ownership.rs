use crate::{
    error::PhygitalError, Asset, Secp256r1Pubkey, PROGRAM_AUTHORITY_SEED, TRANSFER_HOOK_PROGRAM_ID,
};
use anchor_lang::{prelude::*, solana_program::program::invoke_signed};
use anchor_spl::token_2022::{
    close_account, spl_token_2022::instruction::transfer_checked as spl_transfer_checked,
    CloseAccount,
};
use anchor_spl::{
    associated_token::{self, AssociatedToken, Create},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[event]
pub struct RemoveOwnershipEvent {
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub mint: Pubkey,
    pub time: i64,
}

#[derive(Accounts)]
pub struct RemoveOwnership<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = asset.owner.key() == owner.key() @PhygitalError::OwnerMismatch
    )]
    pub asset: Account<'info, Asset>,
    #[account(
        mut,
        seeds = [PROGRAM_AUTHORITY_SEED],
        bump,
    )]
    pub program_authority: SystemAccount<'info>,
    #[account(
        mut,
        constraint = asset.mint == mint.key(),
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: validated and initialized via `associated_token::create_idempotent`
    #[account(mut)]
    pub program_authority_token_account: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = owner_token_account.amount >= 1,
        constraint = owner_token_account.owner == owner.key() @ PhygitalError::OwnerMismatch,
        constraint = owner_token_account.mint == mint.key(),
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
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

pub fn handler(ctx: Context<RemoveOwnership>) -> Result<()> {
    let program_authority_bump = ctx.bumps.program_authority;
    let bump_seed = [program_authority_bump];
    let authority_seed_array = [PROGRAM_AUTHORITY_SEED, &bump_seed[..]];
    let authority_seeds: &[&[u8]] = authority_seed_array.as_slice();
    let signer_seed_array = [authority_seeds];
    let signer_seeds: &[&[&[u8]]] = signer_seed_array.as_slice();

    associated_token::create_idempotent(CpiContext::new_with_signer(
        ctx.accounts.associated_token_program.key(),
        Create {
            payer: ctx.accounts.program_authority.to_account_info(),
            associated_token: ctx
                .accounts
                .program_authority_token_account
                .to_account_info(),
            authority: ctx.accounts.program_authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        signer_seeds,
    ))?;

    let closing_sender_ata = ctx.accounts.owner_token_account.amount == 1;

    let hook_program = ctx.accounts.transfer_hook_program.to_account_info();
    let mut transfer_ix = spl_transfer_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.owner_token_account.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.program_authority_token_account.key(),
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
            ctx.accounts.owner_token_account.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts
                .program_authority_token_account
                .to_account_info(),
            ctx.accounts.program_authority.to_account_info(),
            hook_program,
        ],
        signer_seeds,
    )?;

    ctx.accounts.asset.owner = ctx.accounts.program_authority.key();
    ctx.accounts.asset.is_locked = false;

    if closing_sender_ata {
        close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.owner_token_account.to_account_info(),
                destination: ctx.accounts.program_authority.to_account_info(),
                authority: ctx.accounts.program_authority.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    emit!(RemoveOwnershipEvent {
        owner: ctx.accounts.owner.key(),
        mint: ctx.accounts.mint.key(),
        public_key: ctx.accounts.asset.public_key,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
