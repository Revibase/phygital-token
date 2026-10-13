//! verify.

use super::*;

impl TestContext {
    pub fn verify_ix(
        &self,
        phygital_token: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        message_hash: [u8; 32],
        expected_rp_id: Option<String>,
        expected_origins: Option<Vec<String>>,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::Verify {
                phygital_token,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::Verify {
                secp256r1_verify_args,
                message_hash,
                expected_rp_id,
                expected_origins,
            }
            .data(),
        }
    }

    pub fn send_verify(
        &mut self,
        phygital_token: &MintedPhygitalToken,
        message_hash: [u8; 32],
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        self.send_verify_with_bindings(
            phygital_token,
            message_hash,
            include_secp_ix,
            None,
            None,
            None,
        )
    }

    pub fn send_verify_with_bindings(
        &mut self,
        phygital_token: &MintedPhygitalToken,
        message_hash: [u8; 32],
        include_secp_ix: bool,
        sign_count: Option<u32>,
        expected_rp_id: Option<String>,
        expected_origins: Option<Vec<String>>,
    ) -> litesvm::types::TransactionResult {
        let sign_count =
            sign_count.unwrap_or_else(|| self.next_sign_count(phygital_token.phygital_token));

        let (secp_ix, verify_args) = phygital_token
            .passkey
            .verify_secp256r1_instruction(message_hash, sign_count);
        let verify_ix = self.verify_ix(
            phygital_token.phygital_token,
            verify_args,
            message_hash,
            expected_rp_id,
            expected_origins,
        );

        let instructions = if include_secp_ix {
            vec![secp_ix, verify_ix]
        } else {
            vec![verify_ix]
        };

        let payer = self.payer.insecure_clone();
        Self::send_instructions(&mut self.svm, &instructions, &[&payer])
    }
}
