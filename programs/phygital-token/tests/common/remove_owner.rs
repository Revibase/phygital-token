//! remove_owner.

use super::*;

impl TestContext {
    pub fn remove_owner_ix(&self, owner: Pubkey, phygital_token: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::RemoveOwner {
                owner,
                phygital_token,
                policy: self.policy_pda(phygital_token),
                wallet: self.wallet_pda(phygital_token),
            }
            .to_account_metas(None),
            data: phygital_token::instruction::RemoveOwner {}.data(),
        }
    }

    pub fn send_remove_owner(
        &mut self,
        phygital_token: &MintedPhygitalToken,
        owner: &Keypair,
    ) -> litesvm::types::TransactionResult {
        let ix = self.remove_owner_ix(owner.pubkey(), phygital_token.phygital_token);
        Self::send_instruction(&mut self.svm, ix, &[owner])
    }
}
