use anchor_lang::prelude::Rent;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::spl_token_2022::instruction::initialize_mint2;
use anchor_spl::token_2022::spl_token_2022::state::Mint;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Plain Token-2022 mint without group or metadata extensions.
pub fn create_plain_token2022_mint(svm: &mut LiteSVM, payer: &Keypair) -> Keypair {
    let mint = Keypair::new();
    let authority = Keypair::new();

    let rent: Rent = svm.get_sysvar();
    let rent_lamports = rent.minimum_balance(Mint::LEN);

    svm.airdrop(&payer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();

    let create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent_lamports,
        Mint::LEN as u64,
        &TOKEN_2022_ID,
    );
    super::TestContext::send_instruction(svm, create_ix, &[payer, &mint])
        .expect("create plain mint");

    let init_ix = initialize_mint2(&TOKEN_2022_ID, &mint.pubkey(), &authority.pubkey(), None, 0)
        .expect("init mint2");
    super::TestContext::send_instruction(svm, init_ix, &[&authority]).expect("initialize mint2");

    mint
}
