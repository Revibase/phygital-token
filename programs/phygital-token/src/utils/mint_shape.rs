use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token_2022::spl_token_2022::extension::{
    group_member_pointer::GroupMemberPointer, metadata_pointer::MetadataPointer,
    permanent_delegate::PermanentDelegate, transfer_hook::TransferHook, BaseStateWithExtensions,
    ExtensionType, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as SplMint;

use crate::constants::TRANSFER_HOOK_PROGRAM_ID;
use crate::error::PhygitalError;

/// The exact set of Token-2022 extensions on a phygital design mint —
/// no more, no less. Token-2022 forbids duplicate extension types, so matching this set
/// by length and membership is an exact-equality check.
const EXPECTED_EXTENSIONS: [ExtensionType; 6] = [
    ExtensionType::MetadataPointer,
    ExtensionType::TransferHook,
    ExtensionType::PermanentDelegate,
    ExtensionType::GroupMemberPointer,
    ExtensionType::TokenGroupMember,
    ExtensionType::TokenMetadata,
];

/// Requires an `OptionalNonZeroPubkey`-typed extension field to equal `Some(expected)`.
/// Generic over the field type so the caller never has to name the pod wrapper.
fn expect_pubkey<T>(value: T, expected: Pubkey) -> Result<()>
where
    Option<Pubkey>: TryFrom<T>,
{
    let actual =
        Option::<Pubkey>::try_from(value).map_err(|_| error!(PhygitalError::InvalidMintShape))?;
    require!(actual == Some(expected), PhygitalError::InvalidMintShape);
    Ok(())
}

/// Verifies `mint` carries exactly the program-controlled Token-2022 configuration of a
/// phygital design mint, so `mint_token` only ever runs against a genuine design mint:
///   - 0 decimals and no freeze authority;
///   - permanent delegate == `program_authority` (the program moves tokens on transfer/claim);
///   - transfer hook authority == `program_authority`, program == this project's hook;
///   - metadata pointer authority == `program_authority`, address == the mint itself;
///   - group member pointer authority == `program_authority`, address == the mint itself.
///
/// A mint missing any of these extensions, or with a different authority/target, is rejected.
pub fn verify_program_mint(mint_info: &AccountInfo, program_authority: &Pubkey) -> Result<()> {
    let mint_key = *mint_info.key;
    let data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(PhygitalError::InvalidMintShape))?;

    // Exactly the phygital design-mint extension set — reject any missing or extra extension.
    let extensions = mint
        .get_extension_types()
        .map_err(|_| error!(PhygitalError::InvalidMintShape))?;
    require!(
        extensions.len() == EXPECTED_EXTENSIONS.len(),
        PhygitalError::InvalidMintShape
    );
    require!(
        extensions
            .iter()
            .all(|ext| EXPECTED_EXTENSIONS.contains(ext)),
        PhygitalError::InvalidMintShape
    );

    require!(mint.base.decimals == 0, PhygitalError::InvalidMintShape);
    require!(
        mint.base.freeze_authority == COption::None,
        PhygitalError::InvalidMintShape
    );

    let permanent_delegate = mint
        .get_extension::<PermanentDelegate>()
        .map_err(|_| error!(PhygitalError::InvalidMintShape))?;
    expect_pubkey(permanent_delegate.delegate, *program_authority)?;

    let transfer_hook = mint
        .get_extension::<TransferHook>()
        .map_err(|_| error!(PhygitalError::InvalidMintShape))?;
    expect_pubkey(transfer_hook.authority, *program_authority)?;
    expect_pubkey(transfer_hook.program_id, TRANSFER_HOOK_PROGRAM_ID)?;

    let metadata_pointer = mint
        .get_extension::<MetadataPointer>()
        .map_err(|_| error!(PhygitalError::InvalidMintShape))?;
    expect_pubkey(metadata_pointer.authority, *program_authority)?;
    expect_pubkey(metadata_pointer.metadata_address, mint_key)?;

    let group_member_pointer = mint
        .get_extension::<GroupMemberPointer>()
        .map_err(|_| error!(PhygitalError::InvalidMintShape))?;
    expect_pubkey(group_member_pointer.authority, *program_authority)?;
    expect_pubkey(group_member_pointer.member_address, mint_key)?;

    Ok(())
}
