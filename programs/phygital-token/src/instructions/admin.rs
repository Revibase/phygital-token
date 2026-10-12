use anchor_lang::prelude::*;

use crate::constants::{ADMIN_CONFIG_SEED, PHYGITAL_TOKEN_SEED, POLICY_SEED, WALLET_SEED};
use crate::error::PhygitalError;
use crate::state::{AdminConfig, PhygitalToken, PhygitalTokenType};
use crate::wallet::close_policy_if_exists;
use crate::webauthn::{secp256r1_pda_seed, Secp256r1Pubkey};

#[event]
pub struct CreateConfigEvent {
    pub authority: Pubkey,
}

#[derive(Accounts)]
pub struct CreateConfig<'info> {
    /// Becomes the sole admin on the singleton config. Callable once.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = AdminConfig::LEN,
        seeds = [ADMIN_CONFIG_SEED],
        bump,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

    pub system_program: Program<'info, System>,
}

impl CreateConfig<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        let admin_config = &mut ctx.accounts.admin_config.load_init()?;
        admin_config.bump = ctx.bumps.admin_config;
        admin_config.admin = ctx.accounts.authority.key();

        emit!(CreateConfigEvent {
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }
}

#[event]
pub struct SetAdminEvent {
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct SetIssuerEvent {
    pub admin: Pubkey,
    pub issuer: Pubkey,
}

#[event]
pub struct SetMinterEvent {
    pub admin: Pubkey,
    pub minter: Pubkey,
}

#[derive(Accounts)]
pub struct SetRole<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_admin(&admin.key()) @ PhygitalError::UnauthorizedAdmin,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,
}

impl SetRole<'_> {
    pub fn set_admin(ctx: Context<Self>, new_admin: Pubkey) -> Result<()> {
        let mut config = ctx.accounts.admin_config.load_mut()?;
        config.require_unique_role_key(&new_admin)?;
        let previous_admin = core::mem::replace(&mut config.admin, new_admin);
        emit!(SetAdminEvent {
            previous_admin,
            new_admin,
        });
        Ok(())
    }

    pub fn set_issuer(ctx: Context<Self>, issuer: Pubkey) -> Result<()> {
        let mut config = ctx.accounts.admin_config.load_mut()?;
        config.require_unique_role_key(&issuer)?;
        config.issuer = issuer;
        emit!(SetIssuerEvent {
            admin: ctx.accounts.admin.key(),
            issuer,
        });
        Ok(())
    }

    pub fn set_minter(ctx: Context<Self>, minter: Pubkey) -> Result<()> {
        let mut config = ctx.accounts.admin_config.load_mut()?;
        config.require_unique_role_key(&minter)?;
        config.minter = minter;
        emit!(SetMinterEvent {
            admin: ctx.accounts.admin.key(),
            minter,
        });
        Ok(())
    }
}

#[event]
pub struct InitializeEvent {
    pub authority: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub owner: Pubkey,
    pub token_type: PhygitalTokenType,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeArgs {
    pub identifier: Secp256r1Pubkey,
    pub secp256r1_pubkey: Secp256r1Pubkey,
    pub token_type: PhygitalTokenType,
    pub owner: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: InitializeArgs)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_issuer(&authority.key()) @ PhygitalError::UnauthorizedAuthority,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

    #[account(
        init,
        payer = authority,
        space = PhygitalToken::LEN,
        seeds = [PHYGITAL_TOKEN_SEED, secp256r1_pda_seed(&args.secp256r1_pubkey)],
        bump,
    )]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    pub system_program: Program<'info, System>,
}

impl Initialize<'_> {
    pub fn handler(ctx: Context<Self>, args: InitializeArgs) -> Result<()> {
        let token_key = ctx.accounts.phygital_token.key();
        let (_, wallet_bump) =
            Pubkey::find_program_address(&[WALLET_SEED, token_key.as_ref()], &crate::ID);
        ctx.accounts.phygital_token.load_init()?.init(
            args.identifier,
            args.token_type,
            args.secp256r1_pubkey,
            args.owner,
            wallet_bump,
        )?;

        emit!(InitializeEvent {
            identifier: args.identifier,
            authority: ctx.accounts.authority.key(),
            public_key: args.secp256r1_pubkey,
            owner: args.owner,
            token_type: args.token_type
        });
        Ok(())
    }
}

#[event]
pub struct AssignMintEvent {
    pub public_key: Secp256r1Pubkey,
    pub authority: Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub mint: Pubkey,
}

#[derive(Accounts)]
pub struct AssignMint<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_minter(&authority.key()) @ PhygitalError::UnauthorizedAuthority,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

    #[account(mut)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,
}

impl AssignMint<'_> {
    pub fn handler(ctx: Context<Self>, mint: Pubkey) -> Result<()> {
        let mut token = ctx.accounts.phygital_token.load_mut()?;
        token.mint = mint;

        emit!(AssignMintEvent {
            public_key: token.public_key,
            authority: ctx.accounts.authority.key(),
            identifier: token.identifier,
            mint,
        });
        Ok(())
    }
}

#[event]
pub struct ClosePhygitalTokenEvent {
    pub admin: Pubkey,
    pub rent_recipient: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
}

/// The wallet PDA's assets stay and return if the same passkey is re-initialized.
#[derive(Accounts)]
pub struct ClosePhygitalToken<'info> {
    pub admin: Signer<'info>,

    /// CHECK: receives the closed account's lamports; any system account is fine.
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,

    #[account(
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_admin(&admin.key()) @ PhygitalError::UnauthorizedAdmin,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

    #[account(
        mut,
        close = rent_recipient,
        seeds = [PHYGITAL_TOKEN_SEED, secp256r1_pda_seed(&phygital_token.load()?.public_key)],
        bump,
    )]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// CHECK: seeds-checked; closed to `rent_recipient` if it exists, since
    /// the wallet PDA is unreachable once its token is gone.
    #[account(mut, seeds = [POLICY_SEED, phygital_token.key().as_ref()], bump)]
    pub policy: UncheckedAccount<'info>,
}

impl ClosePhygitalToken<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        close_policy_if_exists(&ctx.accounts.policy, &ctx.accounts.rent_recipient)?;
        let token = ctx.accounts.phygital_token.load()?;

        emit!(ClosePhygitalTokenEvent {
            admin: ctx.accounts.admin.key(),
            rent_recipient: ctx.accounts.rent_recipient.key(),
            public_key: token.public_key,
            identifier: token.identifier,
            owner: token.owner,
            mint: token.mint,
        });
        Ok(())
    }
}
