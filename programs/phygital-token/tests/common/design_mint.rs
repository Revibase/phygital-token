use anchor_lang::prelude::Rent;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::spl_token_2022::state::Mint;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata;
use litesvm::LiteSVM;
use phygital_token::constants::{PROGRAM_AUTHORITY_SEED, TRANSFER_HOOK_PROGRAM_ID};
use phygital_token::utils::validate_metadata_strings;
use solana_keypair::Keypair;
use solana_signer::Signer;
use spl_token_2022_interface::extension::group_member_pointer::instruction::initialize as group_member_pointer_initialize_ix;
use spl_token_2022_interface::extension::metadata_pointer::instruction::initialize as metadata_pointer_initialize_ix;
use spl_token_2022_interface::extension::transfer_hook::instruction::initialize as transfer_hook_initialize_ix;
use spl_token_2022_interface::instruction::{initialize_mint2, initialize_permanent_delegate};
use spl_token_group_interface::instruction::initialize_member;
use spl_token_metadata_interface::instruction::initialize as token_metadata_initialize_ix;

use super::external_group_mint::ExternalGroupMint;
use super::TestContext;

#[derive(Clone, Debug)]
pub struct CreateMintArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

pub struct DesignMintSigners<'a> {
    pub payer: &'a Keypair,
    pub owner: &'a Keypair,
    pub mint_authority: &'a Keypair,
    pub group_mint_authority: &'a Keypair,
    pub mint: &'a Keypair,
}

struct MintAccountLayout {
    initial_data_len: usize,
    rent_lamports: u64,
}

fn mint_metadata_tlv_size(name: &str, symbol: &str, uri: &str) -> usize {
    let metadata = TokenMetadata {
        name: name.to_string(),
        symbol: symbol.to_string(),
        uri: uri.to_string(),
        ..Default::default()
    };
    metadata.tlv_size_of().expect("metadata tlv size")
}

fn design_mint_layout(rent: &Rent, metadata_size: usize) -> MintAccountLayout {
    let initial_extensions = [
        ExtensionType::MetadataPointer,
        ExtensionType::TransferHook,
        ExtensionType::PermanentDelegate,
        ExtensionType::GroupMemberPointer,
    ];
    let final_extensions = [
        ExtensionType::MetadataPointer,
        ExtensionType::TransferHook,
        ExtensionType::PermanentDelegate,
        ExtensionType::GroupMemberPointer,
        ExtensionType::TokenGroupMember,
    ];
    let initial_data_len =
        ExtensionType::try_calculate_account_len::<Mint>(&initial_extensions).expect("initial len");
    let final_data_len = ExtensionType::try_calculate_account_len::<Mint>(&final_extensions)
        .expect("final len")
        + metadata_size;

    MintAccountLayout {
        initial_data_len,
        rent_lamports: rent.minimum_balance(final_data_len),
    }
}

/// Builds the Token-2022 instructions that create a phygital design mint off-chain.
pub fn build_design_mint_instructions(
    program_id: anchor_lang::prelude::Pubkey,
    rent: &Rent,
    signers: DesignMintSigners<'_>,
    group_mint: anchor_lang::prelude::Pubkey,
    args: &CreateMintArgs,
) -> anchor_lang::Result<Vec<Instruction>> {
    validate_metadata_strings(&args.name, &args.symbol, &args.uri)?;

    let program_authority =
        anchor_lang::prelude::Pubkey::find_program_address(&[PROGRAM_AUTHORITY_SEED], &program_id).0;
    let mint_key = signers.mint.pubkey();
    let metadata_size = mint_metadata_tlv_size(&args.name, &args.symbol, &args.uri);
    let layout = design_mint_layout(rent, metadata_size);

    let create_ix = system_instruction::create_account(
        &signers.payer.pubkey(),
        &mint_key,
        layout.rent_lamports,
        layout.initial_data_len as u64,
        &TOKEN_2022_ID,
    );

    let metadata_pointer_ix = metadata_pointer_initialize_ix(
        &TOKEN_2022_ID,
        &mint_key,
        Some(program_authority),
        Some(mint_key),
    )
    .map_err(|_| anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::InstructionMissing))?;

    let transfer_hook_ix = transfer_hook_initialize_ix(
        &TOKEN_2022_ID,
        &mint_key,
        Some(program_authority),
        Some(TRANSFER_HOOK_PROGRAM_ID),
    )
    .map_err(|_| anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::InstructionMissing))?;

    let permanent_delegate_ix = initialize_permanent_delegate(
        &TOKEN_2022_ID,
        &mint_key,
        &program_authority,
    )
    .map_err(|_| anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::InstructionMissing))?;

    let group_member_pointer_ix = group_member_pointer_initialize_ix(
        &TOKEN_2022_ID,
        &mint_key,
        Some(program_authority),
        Some(mint_key),
    )
    .map_err(|_| anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::InstructionMissing))?;

    let init_mint_ix = initialize_mint2(
        &TOKEN_2022_ID,
        &mint_key,
        &signers.mint_authority.pubkey(),
        None,
        0,
    )
    .map_err(|_| anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::InstructionMissing))?;

    let member_ix = initialize_member(
        &TOKEN_2022_ID,
        &mint_key,
        &mint_key,
        &signers.mint_authority.pubkey(),
        &group_mint,
        &signers.group_mint_authority.pubkey(),
    );

    let metadata_ix = token_metadata_initialize_ix(
        &TOKEN_2022_ID,
        &mint_key,
        &signers.owner.pubkey(),
        &mint_key,
        &signers.mint_authority.pubkey(),
        args.name.clone(),
        args.symbol.clone(),
        args.uri.clone(),
    );

    Ok(vec![
        create_ix,
        metadata_pointer_ix,
        transfer_hook_ix,
        permanent_delegate_ix,
        group_member_pointer_ix,
        init_mint_ix,
        member_ix,
        metadata_ix,
    ])
}

pub fn create_design_mint(
    svm: &mut LiteSVM,
    program_id: anchor_lang::prelude::Pubkey,
    payer: &Keypair,
    owner: &Keypair,
    group: &ExternalGroupMint,
    args: CreateMintArgs,
) -> anchor_lang::prelude::Pubkey {
    let mint = Keypair::new();
    let rent: Rent = svm.get_sysvar();
    let instructions = build_design_mint_instructions(
        program_id,
        &rent,
        DesignMintSigners {
            payer,
            owner,
            mint_authority: payer,
            group_mint_authority: &group.authority,
            mint: &mint,
        },
        group.mint.pubkey(),
        &args,
    )
    .expect("build design mint instructions");

    TestContext::send_instruction(
        svm,
        instructions[0].clone(),
        &[payer, &mint],
    )
    .expect("create design mint account");

    for ix in instructions.iter().skip(1).take(4) {
        TestContext::send_instruction(svm, ix.clone(), &[payer])
            .expect("initialize design mint extension");
    }

    TestContext::send_instruction(
        svm,
        instructions[5].clone(),
        &[payer],
    )
    .expect("initialize design mint");

    TestContext::send_instruction(
        svm,
        instructions[6].clone(),
        &[payer, &group.authority],
    )
    .expect("initialize design mint group member");

    TestContext::send_instruction(
        svm,
        instructions[7].clone(),
        &[payer],
    )
    .expect("initialize design mint metadata");

    mint.pubkey()
}
