//! Low-level transaction submission.

use super::*;

impl TestContext {
    pub fn send_instruction(
        svm: &mut LiteSVM,
        instruction: Instruction,
        signers: &[&Keypair],
    ) -> litesvm::types::TransactionResult {
        Self::send_instructions(svm, &[instruction], signers)
    }

    pub fn send_instructions(
        svm: &mut LiteSVM,
        instructions: &[Instruction],
        signers: &[&Keypair],
    ) -> litesvm::types::TransactionResult {
        let blockhash = svm.latest_blockhash();
        let payer = signers
            .first()
            .map(|kp| kp.pubkey())
            .expect("at least one signer");
        let msg = Message::new_with_blockhash(instructions, Some(&payer), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
            .expect("build tx");
        let result = svm.send_transaction(tx);
        svm.expire_blockhash();
        result
    }

    /// Submit an instruction as `payer` without a matching keypair (sigverify disabled).
    pub fn send_instruction_as(
        svm: &mut LiteSVM,
        instruction: Instruction,
        payer: Pubkey,
    ) -> litesvm::types::TransactionResult {
        Self::send_instructions_as(svm, &[instruction], payer)
    }

    /// Submit instructions as `payer` without matching keypairs (sigverify disabled).
    pub fn send_instructions_as(
        svm: &mut LiteSVM,
        instructions: &[Instruction],
        payer: Pubkey,
    ) -> litesvm::types::TransactionResult {
        let blockhash = svm.latest_blockhash();
        let msg = Message::new_with_blockhash(instructions, Some(&payer), &blockhash);
        let tx = VersionedTransaction {
            signatures: vec![Signature::default(); msg.header.num_required_signatures as usize],
            message: VersionedMessage::Legacy(msg),
        };
        let result = svm.send_transaction(tx);
        svm.expire_blockhash();
        result
    }
}
