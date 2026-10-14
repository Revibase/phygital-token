//! The merchant registry.

use super::*;
use phygital_token::{Merchant, MerchantArgs, MerchantStatus, MERCHANT_SEED, REGISTRAR_SEED};

impl TestContext {
    pub fn registrar_config_pda(&self) -> Pubkey {
        Pubkey::find_program_address(&[REGISTRAR_SEED], &self.program_id).0
    }

    pub fn merchant_pda(&self, merchant_key: Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[MERCHANT_SEED, merchant_key.as_ref()], &self.program_id).0
    }

    pub fn set_registrar_ix(&self, admin: Pubkey, registrar: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::SetRegistrar {
                admin,
                admin_config: self.admin_config_pda(),
                registrar_config: self.registrar_config_pda(),
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::SetRegistrar { registrar }.data(),
        }
    }

    /// Sets a fresh, funded registrar and returns it.
    pub fn install_registrar(&mut self) -> Keypair {
        let registrar = Keypair::new();
        self.svm
            .airdrop(&registrar.pubkey(), 10 * LAMPORTS_PER_SOL)
            .expect("airdrop registrar");
        let ix = self.set_registrar_ix(self.admin.pubkey(), registrar.pubkey());
        let admin = self.admin.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&admin]).expect("set registrar");
        registrar
    }

    pub fn register_merchant_ix(
        &self,
        registrar: Pubkey,
        merchant_key: Pubkey,
        payer: Pubkey,
        args: MerchantArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::RegisterMerchant {
                registrar,
                merchant_key,
                payer,
                registrar_config: self.registrar_config_pda(),
                merchant: self.merchant_pda(merchant_key),
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::RegisterMerchant { args }.data(),
        }
    }

    /// Registers `merchant_key` with `payees` and returns nothing on success.
    pub fn register_merchant(
        &mut self,
        registrar: &Keypair,
        merchant_key: &Keypair,
        payees: Vec<Pubkey>,
    ) -> litesvm::types::TransactionResult {
        let args = MerchantArgs {
            payees,
            domain: "cafe.example".into(),
            name: "Cafe".into(),
        };
        let ix = self.register_merchant_ix(
            registrar.pubkey(),
            merchant_key.pubkey(),
            registrar.pubkey(),
            args,
        );
        Self::send_instruction(&mut self.svm, ix, &[registrar, merchant_key])
    }

    pub fn update_merchant_ix(
        &self,
        registrar: Pubkey,
        merchant_key: Pubkey,
        args: MerchantArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::UpdateMerchant {
                registrar,
                registrar_config: self.registrar_config_pda(),
                merchant: self.merchant_pda(merchant_key),
            }
            .to_account_metas(None),
            data: phygital_token::instruction::UpdateMerchant { args }.data(),
        }
    }

    pub fn set_merchant_status(
        &mut self,
        registrar: &Keypair,
        merchant_key: Pubkey,
        status: MerchantStatus,
    ) -> litesvm::types::TransactionResult {
        let ix = Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::UpdateMerchant {
                registrar: registrar.pubkey(),
                registrar_config: self.registrar_config_pda(),
                merchant: self.merchant_pda(merchant_key),
            }
            .to_account_metas(None),
            data: phygital_token::instruction::SetMerchantStatus { status }.data(),
        };
        Self::send_instruction(&mut self.svm, ix, &[registrar])
    }

    pub fn close_merchant(
        &mut self,
        registrar: &Keypair,
        merchant_key: Pubkey,
    ) -> litesvm::types::TransactionResult {
        let ix = Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::CloseMerchant {
                registrar: registrar.pubkey(),
                registrar_config: self.registrar_config_pda(),
                merchant_key,
                merchant: self.merchant_pda(merchant_key),
            }
            .to_account_metas(None),
            data: phygital_token::instruction::CloseMerchant {}.data(),
        };
        Self::send_instruction(&mut self.svm, ix, &[registrar])
    }

    pub fn merchant(&self, merchant_key: Pubkey) -> Option<Merchant> {
        self.svm
            .get_account(&self.merchant_pda(merchant_key))
            .filter(|account| account.owner == self.program_id)
            .map(|account| Merchant::try_deserialize(&mut account.data.as_ref()).expect("merchant"))
    }
}
