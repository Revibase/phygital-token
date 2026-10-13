//! Wallet execution and the accessory policy.

use super::*;

impl TestContext {
    pub fn update_policy_ix(
        &self,
        owner: Pubkey,
        payer: Pubkey,
        phygital_token: Pubkey,
        actions: Vec<PolicyAction>,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::UpdatePolicy {
                owner,
                payer,
                phygital_token,
                policy: self.policy_pda(phygital_token),
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::UpdatePolicy { actions }.data(),
        }
    }

    pub fn send_update_policy(
        &mut self,
        phygital_token: Pubkey,
        owner: &Keypair,
        actions: Vec<PolicyAction>,
    ) -> litesvm::types::TransactionResult {
        let ix = self.update_policy_ix(owner.pubkey(), owner.pubkey(), phygital_token, actions);
        Self::send_instruction(&mut self.svm, ix, &[owner])
    }

    pub fn close_policy_ix(
        &self,
        owner: Pubkey,
        phygital_token: Pubkey,
        wallet: Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::ClosePolicy {
                owner,
                phygital_token,
                policy: self.policy_pda(phygital_token),
                wallet,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::ClosePolicy {}.data(),
        }
    }

    pub fn token_with_policy(
        &mut self,
        token_type: PhygitalTokenType,
        actions: Vec<PolicyAction>,
    ) -> (MintedPhygitalToken, Keypair, Pubkey) {
        let (token, owner) = self.owned_token(token_type);
        self.send_update_policy(token.phygital_token, &owner, actions)
            .expect("update policy");
        let wallet = self.wallet_pda(token.phygital_token);
        self.svm.airdrop(&wallet, 10 * LAMPORTS_PER_SOL).unwrap();
        (token, owner, wallet)
    }

    /// Compact form of `instructions`, whose program and account keys are all
    /// appended to the returned `remaining_accounts` (deduplicated, privileges
    /// merged). The wallet PDA is passed unsigned; the program signs for it.
    pub fn compact(
        &self,
        phygital_token: Pubkey,
        instructions: &[Instruction],
    ) -> (Vec<CompactInstruction>, Vec<AccountMeta>) {
        let wallet = self.wallet_pda(phygital_token);
        let mut remaining: Vec<AccountMeta> = Vec::new();
        let index_of = |meta: AccountMeta, remaining: &mut Vec<AccountMeta>| -> u8 {
            let is_signer = meta.is_signer && meta.pubkey != wallet;
            if let Some(i) = remaining.iter().position(|m| m.pubkey == meta.pubkey) {
                remaining[i].is_signer |= is_signer;
                remaining[i].is_writable |= meta.is_writable;
                return i as u8;
            }
            remaining.push(AccountMeta { is_signer, ..meta });
            (remaining.len() - 1) as u8
        };
        let compact = instructions
            .iter()
            .map(|ix| CompactInstruction {
                program_id_index: index_of(
                    AccountMeta::new_readonly(ix.program_id, false),
                    &mut remaining,
                ),
                account_indexes: ix
                    .accounts
                    .iter()
                    .map(|m| index_of(m.clone(), &mut remaining))
                    .collect(),
                data: ix.data.clone(),
            })
            .collect();
        (compact, remaining)
    }

    pub(super) fn wallet_ix(
        &self,
        phygital_token: Pubkey,
        mut named: Vec<AccountMeta>,
        instructions: &[Instruction],
        data: impl FnOnce(Vec<CompactInstruction>) -> Vec<u8>,
    ) -> Instruction {
        let (compact_instructions, remaining) = self.compact(phygital_token, instructions);
        named.extend(remaining);
        Instruction {
            program_id: self.program_id,
            accounts: named,
            data: data(compact_instructions),
        }
    }

    pub fn execute_with_owner_ix(
        &self,
        owner: Pubkey,
        phygital_token: Pubkey,
        instructions: &[Instruction],
    ) -> Instruction {
        let named = phygital_token::accounts::ExecuteWithOwner {
            owner,
            phygital_token,
            wallet: self.wallet_pda(phygital_token),
            instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
        }
        .to_account_metas(None);
        self.wallet_ix(
            phygital_token,
            named,
            instructions,
            |compact_instructions| {
                phygital_token::instruction::ExecuteWithOwner {
                    compact_instructions,
                }
                .data()
            },
        )
    }

    pub fn send_execute_with_owner(
        &mut self,
        phygital_token: Pubkey,
        owner: &Keypair,
        instructions: &[Instruction],
    ) -> litesvm::types::TransactionResult {
        let ix = self.execute_with_owner_ix(owner.pubkey(), phygital_token, instructions);
        Self::send_instruction(&mut self.svm, ix, &[owner])
    }

    pub(super) fn accessory_accounts(&self, phygital_token: Pubkey) -> Vec<AccountMeta> {
        phygital_token::accounts::ExecuteWithAccessory {
            phygital_token,
            policy: self.policy_pda(phygital_token),
            wallet: self.wallet_pda(phygital_token),
            slot_hashes: SLOT_HASHES_SYSVAR_ID,
            instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
        }
        .to_account_metas(None)
    }

    /// `execute_with_accessory` with explicit tap arguments (which need not
    /// match the instructions, for negative tests).
    pub fn execute_with_accessory_ix(
        &self,
        phygital_token: Pubkey,
        instructions: &[Instruction],
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Instruction {
        let named = self.accessory_accounts(phygital_token);
        self.wallet_ix(
            phygital_token,
            named,
            instructions,
            |compact_instructions| {
                phygital_token::instruction::ExecuteWithAccessory {
                    compact_instructions,
                    secp256r1_verify_args,
                    slot_number,
                }
                .data()
            },
        )
    }

    /// The execute challenge for `instructions`, hashed with the privileges
    /// each account has in the whole `execute_with_accessory` instruction (the
    /// wallet PDA, for one, may be writable only through another reference).
    pub fn execute_challenge(
        &self,
        phygital_token: Pubkey,
        instructions: &[Instruction],
        slot_hash: [u8; 32],
    ) -> [u8; 32] {
        let (compact, remaining) = self.compact(phygital_token, instructions);
        let mut all = self.accessory_accounts(phygital_token);
        all.extend(remaining.iter().cloned());
        let merged = |key: &Pubkey, flag: fn(&AccountMeta) -> bool| {
            all.iter().any(|m| m.pubkey == *key && flag(m))
        };
        build_execute_challenge(&phygital_token, &slot_hash, &compact, |i| {
            remaining.get(i).map(|m| {
                (
                    &m.pubkey,
                    merged(&m.pubkey, |m| m.is_signer),
                    merged(&m.pubkey, |m| m.is_writable),
                )
            })
        })
        .expect("execute challenge")
    }

    /// The secp256r1 precompile ix and `execute_with_accessory` ix for a tap
    /// signing `instructions` at the current slot with the next sign count.
    pub fn execute_with_accessory_ixs(
        &self,
        phygital_token: &MintedPhygitalToken,
        instructions: &[Instruction],
    ) -> (Instruction, Instruction) {
        let token = phygital_token.phygital_token;
        let (slot_number, slot_hash) = current_slot_entry(&self.svm);
        let challenge = self.execute_challenge(token, instructions, slot_hash);
        let (secp_ix, args) = phygital_token
            .passkey
            .secp256r1_instruction_for_challenge(challenge, self.next_sign_count(token));
        let ix = self.execute_with_accessory_ix(token, instructions, args, slot_number);
        (secp_ix, ix)
    }

    /// Tap-signed execute; `self.payer` pays the fee.
    pub fn send_execute_with_accessory(
        &mut self,
        phygital_token: &MintedPhygitalToken,
        instructions: &[Instruction],
    ) -> litesvm::types::TransactionResult {
        let (secp_ix, ix) = self.execute_with_accessory_ixs(phygital_token, instructions);
        let payer = self.payer.insecure_clone();
        Self::send_instructions(&mut self.svm, &[secp_ix, ix], &[&payer])
    }

    pub fn send_preview_execute(
        &mut self,
        phygital_token: Pubkey,
        instructions: &[Instruction],
        origin: Option<&str>,
    ) -> litesvm::types::TransactionResult {
        let named = phygital_token::accounts::PreviewExecute {
            phygital_token,
            policy: self.policy_pda(phygital_token),
            wallet: self.wallet_pda(phygital_token),
            instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
        }
        .to_account_metas(None);
        let ix = self.wallet_ix(
            phygital_token,
            named,
            instructions,
            |compact_instructions| {
                phygital_token::instruction::PreviewExecute {
                    compact_instructions,
                    origin: origin.map(str::to_string),
                }
                .data()
            },
        );
        let payer = self.payer.insecure_clone();
        Self::send_instruction(&mut self.svm, ix, &[&payer])
    }

    pub fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
    }

    /// Controlled and Permanent come out locked; Bearer stays unlocked.
    pub fn owned_token(&mut self, token_type: PhygitalTokenType) -> (MintedPhygitalToken, Keypair) {
        let passkey = TestPasskey::generate();
        let owner = Keypair::new();
        self.svm
            .airdrop(&owner.pubkey(), 10 * LAMPORTS_PER_SOL)
            .expect("airdrop owner");
        let token = if token_type == PhygitalTokenType::Permanent {
            self.init_phygital_token_with_owner(&passkey, token_type, owner.pubkey())
        } else {
            let token = self.init_phygital_token_of_type(&passkey, token_type);
            self.send_set_owner(&token, &owner, true)
                .expect("set owner");
            token
        };
        (token, owner)
    }

    pub fn advance_clock(&mut self, seconds: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar(&clock);
    }
}
