use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::spl_token_2022::state::{Account as SplTokenAccount, Mint};

use crate::error::PhygitalError;

/// Sizing for a Token-2022 mint account created via `system_program::create_account`.
///
/// `initial_data_len` is the `space` passed to `create_account`. It must include only
/// extensions initialized before `InitializeMint2`; extra uninitialized extension bytes
/// break mint initialization.
///
/// `rent_lamports` pre-funds the final account size after post-mint reallocations
/// (group/member extension + on-mint metadata) so later CPIs do not hit
/// `InsufficientFundsForRent`.
pub struct MintAccountLayout {
    pub initial_data_len: usize,
    pub rent_lamports: u64,
}

fn mint_extension_account_len(extension_types: &[ExtensionType]) -> Result<usize> {
    ExtensionType::try_calculate_account_len::<Mint>(extension_types)
        .map_err(|_| error!(PhygitalError::ArithmeticOverflow))
}

fn token_extension_account_len(extension_types: &[ExtensionType]) -> Result<usize> {
    ExtensionType::try_calculate_account_len::<SplTokenAccount>(extension_types)
        .map_err(|_| error!(PhygitalError::ArithmeticOverflow))
}

/// Rent for a Token-2022 token account holding a design mint.
///
/// Recipient ATAs are created via the associated-token program, which initializes
/// `ImmutableOwner` in addition to the mint-required `TransferHookAccount` extension.
pub fn mint_token_account_rent() -> Result<u64> {
    let len = token_extension_account_len(&[
        ExtensionType::ImmutableOwner,
        ExtensionType::TransferHookAccount,
    ])?;
    Ok(Rent::get()?.minimum_balance(len))
}

fn mint_account_layout(
    initial_extensions: &[ExtensionType],
    final_extensions: &[ExtensionType],
    metadata_size: usize,
) -> Result<MintAccountLayout> {
    let initial_data_len = mint_extension_account_len(initial_extensions)?;
    let final_data_len = mint_extension_account_len(final_extensions)?
        .checked_add(metadata_size)
        .ok_or_else(|| error!(PhygitalError::ArithmeticOverflow))?;

    Ok(MintAccountLayout {
        initial_data_len,
        rent_lamports: Rent::get()?.minimum_balance(final_data_len),
    })
}

pub fn mint_layout(metadata_size: usize) -> Result<MintAccountLayout> {
    mint_account_layout(
        &[
            ExtensionType::MetadataPointer,
            ExtensionType::TransferHook,
            ExtensionType::PermanentDelegate,
            ExtensionType::GroupMemberPointer,
        ],
        &[
            ExtensionType::MetadataPointer,
            ExtensionType::TransferHook,
            ExtensionType::PermanentDelegate,
            ExtensionType::GroupMemberPointer,
            ExtensionType::TokenGroupMember,
        ],
        metadata_size,
    )
}
