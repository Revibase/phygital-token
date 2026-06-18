use anchor_lang::prelude::Rent;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::spl_token_2022::instruction::initialize_mint2;
use anchor_spl::token_2022::spl_token_2022::state::Mint;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_signer::Signer;
use spl_token_2022_interface::extension::group_pointer::instruction::initialize as group_pointer_initialize_ix;
use spl_token_2022_interface::extension::metadata_pointer::instruction::initialize as metadata_pointer_initialize_ix;
use spl_token_group_interface::instruction::initialize_group;
use spl_token_metadata_interface::instruction::initialize as token_metadata_initialize_ix;

pub struct ExternalGroupMint {
    pub mint: Keypair,
    pub authority: Keypair,
}

pub fn create_external_group_mint(
    svm: &mut LiteSVM,
    payer: &Keypair,
    name: &str,
    symbol: &str,
    uri: &str,
    max_size: u64,
) -> ExternalGroupMint {
    let mint = Keypair::new();
    let authority = Keypair::new();

    let metadata = TokenMetadata {
        name: name.to_string(),
        symbol: symbol.to_string(),
        uri: uri.to_string(),
        ..Default::default()
    };
    let metadata_size = metadata.tlv_size_of().unwrap();
    let initial_extensions = [ExtensionType::MetadataPointer, ExtensionType::GroupPointer];
    let final_extensions = [
        ExtensionType::MetadataPointer,
        ExtensionType::GroupPointer,
        ExtensionType::TokenGroup,
    ];
    let initial_data_len =
        ExtensionType::try_calculate_account_len::<Mint>(&initial_extensions).expect("initial len");
    let final_data_len = ExtensionType::try_calculate_account_len::<Mint>(&final_extensions)
        .expect("final len")
        + metadata_size;
    let rent: Rent = svm.get_sysvar();
    let rent_lamports = rent.minimum_balance(final_data_len);

    svm.airdrop(&payer.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();

    let create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent_lamports,
        initial_data_len as u64,
        &TOKEN_2022_ID,
    );
    super::TestContext::send_instruction(svm, create_ix, &[payer, &mint])
        .expect("create group mint");

    let mint_pubkey = mint.pubkey();
    let authority_pubkey = authority.pubkey();

    let metadata_pointer_ix = metadata_pointer_initialize_ix(
        &TOKEN_2022_ID,
        &mint_pubkey,
        Some(authority_pubkey),
        Some(mint_pubkey),
    )
    .expect("metadata pointer ix");
    super::TestContext::send_instruction(svm, metadata_pointer_ix, &[payer])
        .expect("metadata pointer");

    let group_pointer_ix = group_pointer_initialize_ix(
        &TOKEN_2022_ID,
        &mint_pubkey,
        Some(authority_pubkey),
        Some(mint_pubkey),
    )
    .expect("group pointer ix");
    super::TestContext::send_instruction(svm, group_pointer_ix, &[payer]).expect("group pointer");

    let init_mint_ix = initialize_mint2(&TOKEN_2022_ID, &mint_pubkey, &authority_pubkey, None, 0)
        .expect("init mint2 ix");
    super::TestContext::send_instruction(svm, init_mint_ix, &[&authority]).expect("init mint2");

    let token_group_ix = initialize_group(
        &TOKEN_2022_ID,
        &mint_pubkey,
        &mint_pubkey,
        &authority_pubkey,
        Some(authority_pubkey),
        max_size,
    );
    super::TestContext::send_instruction(svm, token_group_ix, &[&authority])
        .expect("token group init");

    let token_metadata_ix = token_metadata_initialize_ix(
        &TOKEN_2022_ID,
        &mint_pubkey,
        &authority_pubkey,
        &mint_pubkey,
        &authority_pubkey,
        name.to_string(),
        symbol.to_string(),
        uri.to_string(),
    );
    super::TestContext::send_instruction(svm, token_metadata_ix, &[&authority])
        .expect("token metadata init");

    ExternalGroupMint { mint, authority }
}

/// Group mint whose TokenGroup extension has no update authority set.
pub fn create_group_mint_without_update_authority(
    svm: &mut LiteSVM,
    payer: &Keypair,
    max_size: u64,
) -> Keypair {
    let mint = Keypair::new();
    let authority = Keypair::new();

    let initial_extensions = [ExtensionType::MetadataPointer, ExtensionType::GroupPointer];
    let final_extensions = [
        ExtensionType::MetadataPointer,
        ExtensionType::GroupPointer,
        ExtensionType::TokenGroup,
    ];
    let initial_data_len =
        ExtensionType::try_calculate_account_len::<Mint>(&initial_extensions).expect("initial len");
    let final_data_len =
        ExtensionType::try_calculate_account_len::<Mint>(&final_extensions).expect("final len");
    let rent: Rent = svm.get_sysvar();
    let rent_lamports = rent.minimum_balance(final_data_len);

    svm.airdrop(&payer.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();

    let create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent_lamports,
        initial_data_len as u64,
        &TOKEN_2022_ID,
    );
    super::TestContext::send_instruction(svm, create_ix, &[payer, &mint])
        .expect("create group mint");

    let mint_pubkey = mint.pubkey();
    let authority_pubkey = authority.pubkey();

    let metadata_pointer_ix = metadata_pointer_initialize_ix(
        &TOKEN_2022_ID,
        &mint_pubkey,
        Some(authority_pubkey),
        Some(mint_pubkey),
    )
    .expect("metadata pointer ix");
    super::TestContext::send_instruction(svm, metadata_pointer_ix, &[payer])
        .expect("metadata pointer");

    let group_pointer_ix = group_pointer_initialize_ix(
        &TOKEN_2022_ID,
        &mint_pubkey,
        Some(authority_pubkey),
        Some(mint_pubkey),
    )
    .expect("group pointer ix");
    super::TestContext::send_instruction(svm, group_pointer_ix, &[payer]).expect("group pointer");

    let init_mint_ix = initialize_mint2(&TOKEN_2022_ID, &mint_pubkey, &authority_pubkey, None, 0)
        .expect("init mint2 ix");
    super::TestContext::send_instruction(svm, init_mint_ix, &[&authority]).expect("init mint2");

    let token_group_ix = initialize_group(
        &TOKEN_2022_ID,
        &mint_pubkey,
        &mint_pubkey,
        &authority_pubkey,
        None,
        max_size,
    );
    super::TestContext::send_instruction(svm, token_group_ix, &[&authority])
        .expect("token group init without update authority");

    mint
}
