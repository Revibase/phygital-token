use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::token_2022::{self, initialize_mint2, InitializeMint2};
use anchor_spl::token_2022_extensions::{
    group_pointer_initialize, metadata_pointer_initialize, token_group_initialize,
    token_metadata_initialize, token_metadata_update_field, GroupPointerInitialize,
    MetadataPointerInitialize, TokenGroupInitialize, TokenMetadataInitialize,
    TokenMetadataUpdateField,
};
use anchor_spl::token_interface::TokenInterface;
use spl_token_metadata_interface::state::{Field, TokenMetadata};

use crate::constants::{GROUP_MINT_SEED, PROGRAM_AUTHORITY_SEED};
use crate::utils::{collection_mint_layout, validate_metadata_strings, GROUP_UNIQUE_ID_METADATA_KEY};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateGroupTokenArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    /// Maximum number of NFTs that can join this collection.
    pub max_size: u64,
    /// Unique collection identifier — part of the group mint PDA seeds and on-chain metadata.
    pub unique_id: u64,
}

#[derive(Accounts)]
#[instruction(args: CreateGroupTokenArgs)]
pub struct CreateGroupToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Collection mint authority.
    pub owner: Signer<'info>,

    /// Collection mint PDA — account created in the handler via `create_account` + signer seeds.
    #[account(
        mut,
        seeds = [GROUP_MINT_SEED, &args.unique_id.to_le_bytes()],
        bump,
    )]
    pub group_mint: SystemAccount<'info>,

    #[account(
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

pub fn handler(ctx: Context<CreateGroupToken>, args: CreateGroupTokenArgs) -> Result<()> {
    validate_metadata_strings(&args.name, &args.symbol, &args.uri)?;

    let group_mint_key = ctx.accounts.group_mint.key();
    let unique_id_str = args.unique_id.to_string();

    let mut metadata = TokenMetadata {
        name: args.name.clone(),
        symbol: args.symbol.clone(),
        uri: args.uri.clone(),
        ..Default::default()
    };
    metadata.additional_metadata.push((
        GROUP_UNIQUE_ID_METADATA_KEY.to_string(),
        unique_id_str.clone(),
    ));
    let metadata_size = metadata.tlv_size_of().unwrap();

    let layout = collection_mint_layout(metadata_size)?;

    let group_mint_bump = ctx.bumps.group_mint;
    let unique_id_bytes = args.unique_id.to_le_bytes();
    let bump_seed = [group_mint_bump];
    let seed_array = [
        GROUP_MINT_SEED,
        unique_id_bytes.as_ref(),
        bump_seed.as_ref(),
    ];
    let signer_seeds: &[&[u8]] = seed_array.as_slice();
    let signer_seed_array = [signer_seeds];
    let signer_seeds_invoke: &[&[&[u8]]] = signer_seed_array.as_slice();

    create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.group_mint.to_account_info(),
            },
            signer_seeds_invoke,
        ),
        layout.rent_lamports,
        layout.initial_data_len as u64,
        &token_2022::ID,
    )?;

    let token_program_id = ctx.accounts.token_program.key();
    let token_program = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.group_mint.to_account_info();

    metadata_pointer_initialize(
        CpiContext::new(
            token_program_id,
            MetadataPointerInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        Some(ctx.accounts.owner.key()),
        Some(group_mint_key),
    )?;

    group_pointer_initialize(
        CpiContext::new(
            token_program_id,
            GroupPointerInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        Some(ctx.accounts.owner.key()),
        Some(group_mint_key),
    )?;

    initialize_mint2(
        CpiContext::new(token_program_id, InitializeMint2 { mint: mint.clone() }),
        0,
        &ctx.accounts.owner.key(),
        None,
    )?;

    // `program_authority` is the TokenGroup update authority — used when
    // adding/removing collection members (`create_token`).
    token_group_initialize(
        CpiContext::new(
            token_program_id,
            TokenGroupInitialize {
                program_id: token_program.clone(),
                group: mint.clone(),
                mint: mint.clone(),
                mint_authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        Some(ctx.accounts.program_authority.key()),
        args.max_size,
    )?;

    token_metadata_initialize(
        CpiContext::new(
            token_program_id,
            TokenMetadataInitialize {
                program_id: token_program.clone(),
                metadata: mint.clone(),
                update_authority: ctx.accounts.owner.to_account_info(),
                mint_authority: ctx.accounts.owner.to_account_info(),
                mint: mint.clone(),
            },
        ),
        args.name,
        args.symbol,
        args.uri,
    )?;

    token_metadata_update_field(
        CpiContext::new(
            token_program_id,
            TokenMetadataUpdateField {
                program_id: token_program,
                metadata: mint,
                update_authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        Field::Key(GROUP_UNIQUE_ID_METADATA_KEY.to_string()),
        unique_id_str,
    )?;

    Ok(())
}
