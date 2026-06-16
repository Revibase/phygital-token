use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::error::PhygitalError;
use crate::state::{find_card_instance_pda, CardInstance};
use crate::utils::Secp256r1VerifyArgs;

/// Permissionlessly advances a card's on-chain counter to a freshly verified tap.
///
/// Off-chain verification increments the physical tag counter
/// without touching the chain, so the on-chain `last_counter` drifts behind. That gap
/// would let an attacker replay any captured tap whose counter is still greater than the
/// stale on-chain value. Calling this with the latest tap closes the gap and invalidates
/// every earlier captured URL. It moves only the counter — no token movement, no owner
/// change — so anyone holding a valid fresh tap may submit it.
#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Secp256r1VerifyArgs)]
pub struct UpdateCounter<'info> {
    #[account(
        mut,
        constraint = {
            let extracted_pubkey = secp256r1_verify_args.extract_public_key_from_instruction(&instructions_sysvar)?;
            let (expected_pda, _) = find_card_instance_pda(&extracted_pubkey, &crate::ID);
            card_instance.key() == expected_pda
        } @ PhygitalError::Secp256r1PubkeyMismatch,
    )]
    pub card_instance: Account<'info, CardInstance>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<UpdateCounter>,
    secp256r1_verify_args: Secp256r1VerifyArgs,
) -> Result<()> {
    // The secp256r1 precompile in the preceding instruction has already verified the
    // tag's signature over `counter || nonce`. Advancing requires a strictly greater
    // counter, so a stale tap is rejected rather than silently ignored.
    let tap_counter =
        secp256r1_verify_args.extract_tap_counter(&ctx.accounts.instructions_sysvar)?;
    ctx.accounts.card_instance.advance_counter(tap_counter)?;

    msg!(
        "update_counter: instance {} advanced to counter {}",
        ctx.accounts.card_instance.key(),
        tap_counter,
    );

    Ok(())
}
