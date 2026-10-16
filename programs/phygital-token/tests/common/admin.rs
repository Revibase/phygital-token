//! Role registry: create_config, set_admin/issuer/minter.

use super::*;

impl TestContext {
    pub fn create_config_ix(&self, authority: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::CreateConfig {
                authority,
                admin_config: self.admin_config_pda(),
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::CreateConfig {}.data(),
        }
    }

    pub(super) fn bootstrap_admin_config(&mut self) {
        let admin = self.admin.insecure_clone();
        let ix = self.create_config_ix(admin.pubkey());
        Self::send_instruction(&mut self.svm, ix, &[&admin]).expect("create_config");

        self.send_set_issuer(self.issuer.pubkey())
            .expect("bootstrap set_issuer");
        self.send_set_minter(self.minter.pubkey())
            .expect("bootstrap set_minter");
    }

    pub fn set_issuer_ix(&self, admin: Pubkey, issuer: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::SetRole {
                admin,
                admin_config: self.admin_config_pda(),
            }
            .to_account_metas(None),
            data: phygital_token::instruction::SetIssuer { issuer }.data(),
        }
    }

    pub fn send_set_issuer(&mut self, issuer: Pubkey) -> litesvm::types::TransactionResult {
        let ix = self.set_issuer_ix(self.admin.pubkey(), issuer);
        let admin = self.admin.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&admin])
    }

    pub fn set_minter_ix(&self, admin: Pubkey, minter: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::SetRole {
                admin,
                admin_config: self.admin_config_pda(),
            }
            .to_account_metas(None),
            data: phygital_token::instruction::SetMinter { minter }.data(),
        }
    }

    pub fn send_set_minter(&mut self, minter: Pubkey) -> litesvm::types::TransactionResult {
        let ix = self.set_minter_ix(self.admin.pubkey(), minter);
        let admin = self.admin.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&admin])
    }

    pub fn set_admin_ix(&self, admin: Pubkey, new_admin: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::SetRole {
                admin,
                admin_config: self.admin_config_pda(),
            }
            .to_account_metas(None),
            data: phygital_token::instruction::SetAdmin { new_admin }.data(),
        }
    }

    pub fn close_phygital_token_ix(
        &self,
        admin: Pubkey,
        rent_recipient: Pubkey,
        phygital_token: Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::ClosePhygitalToken {
                admin,
                rent_recipient,
                admin_config: self.admin_config_pda(),
                phygital_token,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::ClosePhygitalToken {}.data(),
        }
    }

    pub fn send_close_phygital_token(
        &mut self,
        rent_recipient: Pubkey,
        phygital_token: Pubkey,
    ) -> litesvm::types::TransactionResult {
        let ix = self.close_phygital_token_ix(self.admin.pubkey(), rent_recipient, phygital_token);
        let admin = self.admin.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&admin])
    }
}
