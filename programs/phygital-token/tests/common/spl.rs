//! SPL Token and Token-2022 fixtures (LiteSVM ships both programs).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::spl_token_2022::extension::account_len::try_calculate_account_len_from_mint_data;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::instruction::initialize_transfer_fee_config;
use anchor_spl::token_2022::spl_token_2022::extension::{ExtensionType, StateWithExtensions};
use anchor_spl::token_2022::spl_token_2022::instruction::{
    approve_checked, freeze_account, initialize_account3, initialize_mint2, mint_to, revoke,
};
use anchor_spl::token_2022::spl_token_2022::state::{Account as TokenAccountState, Mint};
use solana_keypair::Keypair;
use solana_signer::Signer;

use super::TestContext;

pub const DECIMALS: u8 = 6;
pub const SPL_TOKEN: Pubkey = anchor_spl::token::ID;
pub const TOKEN_2022: Pubkey = anchor_spl::token_2022::ID;

impl TestContext {
    /// New mint under `program` whose mint and freeze authority is `self.payer`.
    pub fn create_mint(&mut self, program: Pubkey) -> Pubkey {
        self.create_mint_with_fee(program, None)
    }

    /// New Token-2022 mint with a transfer fee of `basis_points` (capped at `max_fee`).
    pub fn create_fee_mint(&mut self, basis_points: u16, max_fee: u64) -> Pubkey {
        self.create_mint_with_fee(TOKEN_2022, Some((basis_points, max_fee)))
    }

    fn create_mint_with_fee(&mut self, program: Pubkey, fee: Option<(u16, u64)>) -> Pubkey {
        let mint = Keypair::new();
        let len = if fee.is_some() {
            ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferFeeConfig])
                .expect("mint len")
        } else {
            Mint::LEN
        };
        let rent: Rent = self.svm.get_sysvar();
        let payer_key = self.payer.pubkey();
        let mut instructions = vec![system_instruction::create_account(
            &payer_key,
            &mint.pubkey(),
            rent.minimum_balance(len),
            len as u64,
            &program,
        )];
        if let Some((basis_points, max_fee)) = fee {
            instructions.push(
                initialize_transfer_fee_config(
                    &program,
                    &mint.pubkey(),
                    Some(&payer_key),
                    Some(&payer_key),
                    basis_points,
                    max_fee,
                )
                .expect("initialize_transfer_fee_config"),
            );
        }
        instructions.push(
            initialize_mint2(
                &program,
                &mint.pubkey(),
                &payer_key,
                Some(&payer_key),
                DECIMALS,
            )
            .expect("initialize_mint2"),
        );
        let payer = self.payer.insecure_clone();
        Self::send_instructions(&mut self.svm, &instructions, &[&payer, &mint])
            .expect("create mint");
        mint.pubkey()
    }

    pub fn create_token_account(&mut self, owner: Pubkey, mint: Pubkey) -> Pubkey {
        let program = self.svm.get_account(&mint).expect("mint").owner;
        let mint_data = self.svm.get_account(&mint).expect("mint").data;
        let len = if program == TOKEN_2022 {
            try_calculate_account_len_from_mint_data(&mint_data, &[]).expect("account len")
        } else {
            TokenAccountState::LEN
        };
        let account = Keypair::new();
        let rent: Rent = self.svm.get_sysvar();
        let create_ix = system_instruction::create_account(
            &self.payer.pubkey(),
            &account.pubkey(),
            rent.minimum_balance(len),
            len as u64,
            &program,
        );
        let init_ix = initialize_account3(&program, &account.pubkey(), &mint, &owner)
            .expect("initialize_account3");
        let payer = self.payer.insecure_clone();
        Self::send_instructions(&mut self.svm, &[create_ix, init_ix], &[&payer, &account])
            .expect("create token account");
        account.pubkey()
    }

    pub fn mint_tokens(&mut self, mint: Pubkey, destination: Pubkey, amount: u64) {
        let program = self.svm.get_account(&mint).expect("mint").owner;
        let ix = mint_to(
            &program,
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

    pub fn freeze(&mut self, account: Pubkey, mint: Pubkey) {
        let program = self.svm.get_account(&mint).expect("mint").owner;
        let ix = freeze_account(&program, &account, &mint, &self.payer.pubkey(), &[])
            .expect("freeze_account");
        let payer = self.payer.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&payer]).expect("freeze");
    }

    pub fn token_balance(&self, token_account: Pubkey) -> u64 {
        self.token_account(token_account).amount
    }

    pub fn delegated_amount(&self, token_account: Pubkey) -> u64 {
        self.token_account(token_account).delegated_amount
    }

    fn token_account(&self, token_account: Pubkey) -> TokenAccountState {
        let account = self.svm.get_account(&token_account).expect("token account");
        StateWithExtensions::<TokenAccountState>::unpack(&account.data)
            .expect("unpack token account")
            .base
    }

    /// Owner approves `delegate` for `amount` on `source`.
    pub fn approve(
        &mut self,
        source: Pubkey,
        mint: Pubkey,
        delegate: Pubkey,
        owner: &Keypair,
        amount: u64,
    ) -> litesvm::types::TransactionResult {
        let program = self.svm.get_account(&mint).expect("mint").owner;
        let ix = approve_checked(
            &program,
            &source,
            &mint,
            &delegate,
            &owner.pubkey(),
            &[],
            amount,
            DECIMALS,
        )
        .expect("approve_checked");
        Self::send_instruction(&mut self.svm, ix, &[owner])
    }

    pub fn revoke(
        &mut self,
        source: Pubkey,
        mint: Pubkey,
        owner: &Keypair,
    ) -> litesvm::types::TransactionResult {
        let program = self.svm.get_account(&mint).expect("mint").owner;
        let ix: Instruction = revoke(&program, &source, &owner.pubkey(), &[]).expect("revoke");
        Self::send_instruction(&mut self.svm, ix, &[owner])
    }
}
