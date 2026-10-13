//! Creating tokens.

use super::*;

impl TestContext {
    pub fn initialize_ix(
        &self,
        authority: Pubkey,
        phygital_token: Pubkey,
        args: InitializeArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::Initialize {
                authority,
                admin_config: self.admin_config_pda(),
                phygital_token,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::Initialize { args }.data(),
        }
    }

    /// Create a transferable phygital_token controlled by `passkey`.
    pub fn init_phygital_token(&mut self, passkey: &TestPasskey) -> MintedPhygitalToken {
        self.init_phygital_token_of_type(passkey, PhygitalTokenType::Bearer)
    }

    /// Create a phygital_token of the given type (`Controlled`, `Bearer`, or `Permanent`).
    ///
    /// Permanent tokens require a non-default owner — use
    /// [`Self::init_phygital_token_with_owner`] instead.
    pub fn init_phygital_token_of_type(
        &mut self,
        passkey: &TestPasskey,
        token_type: PhygitalTokenType,
    ) -> MintedPhygitalToken {
        self.init_phygital_token_with_identifier(
            unique_identifier(),
            passkey,
            token_type,
            Pubkey::default(),
        )
    }

    /// Create a phygital_token with an explicit initial `owner` (required for `Permanent`).
    pub fn init_phygital_token_with_owner(
        &mut self,
        passkey: &TestPasskey,
        token_type: PhygitalTokenType,
        owner: Pubkey,
    ) -> MintedPhygitalToken {
        self.init_phygital_token_with_identifier(unique_identifier(), passkey, token_type, owner)
    }

    /// Create a phygital_token with an explicit chip `identifier` (binding field) and a
    /// `passkey` whose public key seeds the PDA and authorizes transfers.
    pub fn init_phygital_token_with_identifier(
        &mut self,
        identifier: Secp256r1Pubkey,
        passkey: &TestPasskey,
        token_type: PhygitalTokenType,
        owner: Pubkey,
    ) -> MintedPhygitalToken {
        let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
        let phygital_token = self.phygital_token_pda(&secp256r1_pubkey);
        let args = InitializeArgs {
            identifier,
            secp256r1_pubkey,
            token_type,
            owner,
        };
        let ix = self.initialize_ix(self.issuer.pubkey(), phygital_token, args);
        let issuer = self.issuer.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&issuer]).expect("initialize phygital_token");

        MintedPhygitalToken {
            phygital_token,
            identifier,
            passkey: passkey.clone(),
        }
    }
}
