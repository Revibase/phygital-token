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
        let (slot_number, slot_hash) = self.advance_past_last_slot(phygital_token.phygital_token);
        self.send_set_owner_at_slot(
            phygital_token,
            recipient,
            include_secp_ix,
            Some(slot_number),
            Some(slot_hash),
        )
    }

    pub fn send_set_owner_at_slot(
        &mut self,
        phygital_token: &MintedPhygitalToken,
        recipient: &Keypair,
        include_secp_ix: bool,
        slot_number: Option<u64>,
        slot_hash: Option<[u8; 32]>,
    ) -> litesvm::types::TransactionResult {
        let (slot_number, slot_hash) = match (slot_number, slot_hash) {
            (Some(slot), Some(hash)) => (slot, hash),
            _ => current_slot_entry(&self.svm),
        };

        let (secp_ix, verify_args) = phygital_token.passkey.secp256r1_instruction(
            phygital_token.phygital_token,
            recipient.pubkey(),
            slot_hash,
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

        ensure_funded(&mut self.svm, recipient);

        Self::send_instructions(&mut self.svm, &instructions, &[recipient])
    }
}

fn ensure_funded(svm: &mut LiteSVM, recipient: &Keypair) {
    let lamports = svm
        .get_account(&recipient.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);
    if lamports < LAMPORTS_PER_SOL {
        svm.airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL).ok();
    }
}
