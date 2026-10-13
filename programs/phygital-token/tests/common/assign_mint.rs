//! assign_mint.

use super::*;

impl TestContext {
    pub fn assign_mint_ix(
        &self,
        authority: Pubkey,
        phygital_token: Pubkey,
        mint: Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::AssignMint {
                authority,
                admin_config: self.admin_config_pda(),
                phygital_token,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::AssignMint { mint }.data(),
        }
    }

    pub fn send_assign_mint(
        &mut self,
        phygital_token: Pubkey,
        mint: Pubkey,
    ) -> litesvm::types::TransactionResult {
        let ix = self.assign_mint_ix(self.minter.pubkey(), phygital_token, mint);
        let minter = self.minter.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&minter])
    }
}
