//! set_owner.

use super::*;

impl TestContext {
    pub fn set_owner_ix(
        &self,
        recipient: Pubkey,
        phygital_token: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::SetOwner {
                recipient,
                phygital_token,
                slot_hashes: SLOT_HASHES_SYSVAR_ID,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::SetOwner {
                secp256r1_verify_args,
                slot_number,
            }
            .data(),
        }
    }

    pub fn send_set_owner(
        &mut self,
        phygital_token: &MintedPhygitalToken,
        recipient: &Keypair,
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        self.send_set_owner_at_slot(phygital_token, recipient, include_secp_ix, None, None, None)
    }

    pub fn send_set_owner_at_slot(
        &mut self,
        phygital_token: &MintedPhygitalToken,
        recipient: &Keypair,
        include_secp_ix: bool,
        slot_number: Option<u64>,
        slot_hash: Option<[u8; 32]>,
        sign_count: Option<u32>,
    ) -> litesvm::types::TransactionResult {
        let (slot_number, slot_hash) = match (slot_number, slot_hash) {
            (Some(slot), Some(hash)) => (slot, hash),
            _ => current_slot_entry(&self.svm),
        };
        let sign_count =
            sign_count.unwrap_or_else(|| self.next_sign_count(phygital_token.phygital_token));

        let (secp_ix, verify_args) = phygital_token.passkey.secp256r1_verify_instruction(
            phygital_token.phygital_token,
            slot_hash,
            sign_count,
        );

        let transfer_ix = self.set_owner_ix(
            recipient.pubkey(),
            phygital_token.phygital_token,
            verify_args,
            slot_number,
        );

        let instructions = if include_secp_ix {
            vec![secp_ix, transfer_ix]
        } else {
            vec![transfer_ix]
        };

        self.svm
            .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
            .ok();

        Self::send_instructions(&mut self.svm, &instructions, &[recipient])
    }

    /// Submit a hand-built instruction list (for negative/edge cases). The first
    /// signer pays fees.
    pub fn send_set_owner_with_instructions(
        &mut self,
        instructions: Vec<Instruction>,
        signers: &[&Keypair],
    ) -> litesvm::types::TransactionResult {
        Self::send_instructions(&mut self.svm, &instructions, signers)
    }
}
