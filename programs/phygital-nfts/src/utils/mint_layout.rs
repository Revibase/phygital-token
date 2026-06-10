use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::spl_token_2022::state::Mint;

use crate::error::TokenProgramError;

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
        .map_err(|_| error!(TokenProgramError::ArithmeticOverflow))
}

fn mint_account_layout(
    initial_extensions: &[ExtensionType],
    final_extensions: &[ExtensionType],
    metadata_size: usize,
) -> Result<MintAccountLayout> {
    let initial_data_len = mint_extension_account_len(initial_extensions)?;
    let final_data_len = mint_extension_account_len(final_extensions)?
        .checked_add(metadata_size)
        .ok_or_else(|| error!(TokenProgramError::ArithmeticOverflow))?;

    Ok(MintAccountLayout {
        initial_data_len,
        rent_lamports: Rent::get()?.minimum_balance(final_data_len),
    })
}

/// Token-2022 mint account size before `InitializeMint2` (metadata + group pointers only).
pub const COLLECTION_MINT_INITIAL_LEN: usize = 302;

pub fn collection_mint_initial_len() -> usize {
    mint_extension_account_len(&[ExtensionType::MetadataPointer, ExtensionType::GroupPointer])
        .expect("collection mint initial len")
}

pub fn collection_mint_layout(metadata_size: usize) -> Result<MintAccountLayout> {
    mint_account_layout(
        &[ExtensionType::MetadataPointer, ExtensionType::GroupPointer],
        &[
            ExtensionType::MetadataPointer,
            ExtensionType::GroupPointer,
            ExtensionType::TokenGroup,
        ],
        metadata_size,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collection_mint_initial_len_matches_constant() {
        assert_eq!(
            collection_mint_initial_len(),
            COLLECTION_MINT_INITIAL_LEN,
            "update COLLECTION_MINT_INITIAL_LEN if extension sizes change"
        );
    }
}

pub fn member_mint_layout(metadata_size: usize) -> Result<MintAccountLayout> {
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
