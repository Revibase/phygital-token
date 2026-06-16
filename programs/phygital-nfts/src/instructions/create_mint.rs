use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::token_2022::{
    self, initialize_mint2, InitializeMint2,
};
use anchor_spl::token_2022_extensions::{
    group_member_pointer_initialize, metadata_pointer_initialize, permanent_delegate_initialize,
    token_member_initialize, token_metadata_initialize, transfer_hook_initialize,
    GroupMemberPointerInitialize, MetadataPointerInitialize, PermanentDelegateInitialize,
    TokenMemberInitialize, TokenMetadataInitialize, TransferHookInitialize,
};
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::{PROGRAM_AUTHORITY_SEED, TRANSFER_HOOK_PROGRAM_ID};
use crate::utils::{
    mint_layout, mint_metadata_tlv_size, validate_metadata_strings,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateMintArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String
}

#[derive(Accounts)]
#[instruction(args: CreateMintArgs)]
pub struct CreateMint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub owner: Signer<'info>,

    #[account(mut)]
    pub group_mint: Box<InterfaceAccount<'info, Mint>>,

    pub group_mint_authority: Signer<'info>,

    #[account(mut)]
    pub mint: Signer<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_AUTHORITY_SEED],
        bump,
    )]
    pub program_authority: SystemAccount<'info>,

    #[account(
        address = token_2022::ID
    )]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateMint>, args: CreateMintArgs) -> Result<()> {
    validate_metadata_strings(&args.name, &args.symbol, &args.uri)?;

    let mint_key = ctx.accounts.mint.key();
    let program_authority_bump = ctx.bumps.program_authority;
    let authority_bump_seed = [program_authority_bump];
    let authority_seed_array = [PROGRAM_AUTHORITY_SEED, authority_bump_seed.as_ref()];
    let authority_seeds: &[&[u8]] = authority_seed_array.as_slice();
    let authority_signer_seed_array = [authority_seeds];
    let authority_signer_seeds: &[&[&[u8]]] = authority_signer_seed_array.as_slice();

    let metadata_size = mint_metadata_tlv_size(&args.name, &args.symbol, &args.uri)?;
    let layout = mint_layout(metadata_size)?;

    create_account(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            }
        ),
        layout.rent_lamports,
        layout.initial_data_len as u64,
        &token_2022::ID,
    )?;

    let token_program_id = ctx.accounts.token_program.key();
    let token_program = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();

    metadata_pointer_initialize(
        CpiContext::new(
            token_program_id,
            MetadataPointerInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        Some(ctx.accounts.program_authority.key()),
        Some(mint_key),
    )?;

    transfer_hook_initialize(
        CpiContext::new(
            token_program_id,
            TransferHookInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        Some(ctx.accounts.program_authority.key()),
        Some(TRANSFER_HOOK_PROGRAM_ID),
    )?;

    permanent_delegate_initialize(
        CpiContext::new(
            token_program_id,
            PermanentDelegateInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        &ctx.accounts.program_authority.key(),
    )?;

    group_member_pointer_initialize(
        CpiContext::new(
            token_program_id,
            GroupMemberPointerInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        Some(ctx.accounts.program_authority.key()),
        Some(mint_key),
    )?;

    initialize_mint2(
        CpiContext::new_with_signer(
            token_program_id,
            InitializeMint2 { mint: mint.clone() },
            authority_signer_seeds,
        ),
        0,
        &ctx.accounts.program_authority.key(),
        None,
    )?;

    token_member_initialize(CpiContext::new_with_signer(
        token_program_id,
        TokenMemberInitialize {
            program_id: token_program.clone(),
            member: mint.clone(),
            member_mint: mint.clone(),
            member_mint_authority: ctx.accounts.program_authority.to_account_info(),
            group: ctx.accounts.group_mint.to_account_info(),
            group_update_authority: ctx.accounts.group_mint_authority.to_account_info(),
        },
        authority_signer_seeds,
    ))?;

    token_metadata_initialize(
        CpiContext::new_with_signer(
            token_program_id,
            TokenMetadataInitialize {
                program_id: token_program.clone(),
                metadata: mint.clone(),
                update_authority: ctx.accounts.owner.to_account_info(),
                mint_authority: ctx.accounts.program_authority.to_account_info(),
                mint: mint.clone(),
            },
            authority_signer_seeds,
        ),
        args.name,
        args.symbol,
        args.uri,
    )?;

    Ok(())
}
