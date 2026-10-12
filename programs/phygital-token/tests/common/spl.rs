//! Token-2022 fixtures for wallet tests (LiteSVM ships the Token-2022 program).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
pub use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_2022::spl_token_2022::instruction::{
    approve_checked, close_account, initialize_account3, initialize_mint2, mint_to, set_authority,
    transfer_checked,
};
use anchor_spl::token_2022::spl_token_2022::state::{Account as TokenAccountState, Mint};
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use solana_keypair::Keypair;
use solana_signer::Signer;

use super::TestContext;

pub const DECIMALS: u8 = 6;

impl TestContext {
    /// New Token-2022 mint whose mint authority is `self.payer`.
    pub fn create_mint(&mut self) -> Pubkey {
        let mint = Keypair::new();
        let rent: Rent = self.svm.get_sysvar();
        let create_ix = system_instruction::create_account(
            &self.payer.pubkey(),
            &mint.pubkey(),
            rent.minimum_balance(Mint::LEN),
            Mint::LEN as u64,
            &TOKEN_2022_ID,
        );
        let init_ix = initialize_mint2(
            &TOKEN_2022_ID,
            &mint.pubkey(),
            &self.payer.pubkey(),
            None,
            DECIMALS,
        )
        .expect("initialize_mint2");
        let payer = self.payer.insecure_clone();
        Self::send_instructions(&mut self.svm, &[create_ix, init_ix], &[&payer, &mint])
            .expect("create mint");
        mint.pubkey()
    }

    pub fn create_token_account(&mut self, owner: Pubkey, mint: Pubkey) -> Pubkey {
        let account = Keypair::new();
        let rent: Rent = self.svm.get_sysvar();
        let create_ix = system_instruction::create_account(
            &self.payer.pubkey(),
            &account.pubkey(),
            rent.minimum_balance(TokenAccountState::LEN),
            TokenAccountState::LEN as u64,
            &TOKEN_2022_ID,
        );
        let init_ix = initialize_account3(&TOKEN_2022_ID, &account.pubkey(), &mint, &owner)
            .expect("initialize_account3");
        let payer = self.payer.insecure_clone();
        Self::send_instructions(&mut self.svm, &[create_ix, init_ix], &[&payer, &account])
            .expect("create token account");
        account.pubkey()
    }

    pub fn mint_tokens(&mut self, mint: Pubkey, destination: Pubkey, amount: u64) {
        let ix = mint_to(
            &TOKEN_2022_ID,
            &mint,
            &destination,
            &self.payer.pubkey(),
            &[],
            amount,
        )
        .expect("mint_to");
        let payer = self.payer.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&payer]).expect("mint tokens");
    }

    pub fn token_balance(&self, token_account: Pubkey) -> u64 {
        let account = self.svm.get_account(&token_account).expect("token account");
        TokenAccountState::unpack_from_slice(&account.data)
            .expect("unpack token account")
            .amount
    }
}

pub fn token_transfer_ix(
    source: Pubkey,
    mint: Pubkey,
    destination: Pubkey,
    authority: Pubkey,
    amount: u64,
) -> Instruction {
    transfer_checked(
        &TOKEN_2022_ID,
        &source,
        &mint,
        &destination,
        &authority,
        &[],
        amount,
        DECIMALS,
    )
    .expect("transfer_checked")
}

pub fn token_approve_ix(
    source: Pubkey,
    mint: Pubkey,
    delegate: Pubkey,
    owner: Pubkey,
    amount: u64,
) -> Instruction {
    approve_checked(
        &TOKEN_2022_ID,
        &source,
        &mint,
        &delegate,
        &owner,
        &[],
        amount,
        DECIMALS,
    )
    .expect("approve_checked")
}

pub fn token_set_authority_ix(
    account: Pubkey,
    new_authority: Option<Pubkey>,
    authority_type: AuthorityType,
    owner: Pubkey,
) -> Instruction {
    set_authority(
        &TOKEN_2022_ID,
        &account,
        new_authority.as_ref(),
        authority_type,
        &owner,
        &[],
    )
    .expect("set_authority")
}

pub fn token_close_ix(account: Pubkey, destination: Pubkey, owner: Pubkey) -> Instruction {
    close_account(&TOKEN_2022_ID, &account, &destination, &owner, &[]).expect("close_account")
}
