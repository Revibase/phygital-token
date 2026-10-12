// Shared test harness: each integration-test binary pulls in this module via
// `mod common;` and uses only a subset of the helpers, so per-binary dead-code
// warnings are expected and not meaningful here.
#![allow(dead_code, unused_imports)]

mod assertions;
mod secp256r1;
mod spl;

pub use assertions::{assert_phygital_token_program_error, assert_transaction_failed};

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{prelude::*, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use phygital_token::{
    build_execute_challenge, secp256r1_pda_seed, AccessoryPolicy, CompactInstruction,
    InitializeArgs, PhygitalToken, PhygitalTokenType, PolicyAction, ProgramAccess,
    ProgramPermission, Secp256r1Pubkey, Secp256r1VerifyArgs, ADMIN_CONFIG_SEED,
    PHYGITAL_TOKEN_SEED, POLICY_SEED, WALLET_SEED,
};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_sdk_ids::sysvar::{
    instructions::ID as INSTRUCTIONS_SYSVAR_ID, slot_hashes::ID as SLOT_HASHES_SYSVAR_ID,
};
use solana_signature::Signature;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub use secp256r1::{current_slot_entry, TestPasskey};
pub use spl::{
    token_approve_ix, token_close_ix, token_set_authority_ix, token_transfer_ix, AuthorityType,
    DECIMALS,
};

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const TEST_RP_ID: &str = "localhost";
pub const TEST_ORIGIN: &str = "http://localhost:3000";

// Domain vocabulary (see GLOSSARY.md at repo root):
//   Token      = PhygitalToken PDA created by `initialize` (1:1 with a passkey)
//   Owner = phygital_token.owner (current custodian; `Pubkey::default()` when unowned)
//   Mint       = optional SPL mint pubkey, set later via `assign_mint` (default until then)
//
// Owner lives in the PhygitalToken PDA and is moved by `set_owner`
// after a secp256r1/WebAuthn proof. `assign_mint` binds an SPL mint after init.
//
// AdminConfig roles: admin (manages roles), issuer (initialize), minter (assign_mint).

/// A freshly `initialize`d phygital_token plus the passkey that controls its transfers.
///
/// `identifier` is a chip binding field stored on the phygital_token. The PDA is seeded
/// by `passkey`'s public key (which also authorizes transfers).
pub struct MintedPhygitalToken {
    pub phygital_token: Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub passkey: TestPasskey,
}

/// Generate a unique chip identifier, distinct from any passkey public key.
/// Stored on the phygital_token for binding; not used as the PDA seed.
pub fn unique_identifier() -> Secp256r1Pubkey {
    use rand::RngCore;
    let mut bytes = [0u8; 33];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes[0] = 0x02; // compressed-point prefix, for realism
    Secp256r1Pubkey(bytes)
}

pub struct TestContext {
    pub svm: LiteSVM,
    pub payer: Keypair,
    /// Sole admin after `create_config` bootstrap.
    pub admin: Keypair,
    /// Issuer role — sole authority for `initialize`.
    pub issuer: Keypair,
    /// Minter role — sole authority for `assign_mint`.
    pub minter: Keypair,
    pub program_id: Pubkey,
}

fn program_artifact_paths(manifest_dir: &std::path::Path, name: &str) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if let Ok(cargo_target_dir) = std::env::var("CARGO_TARGET_DIR") {
        let base = std::path::PathBuf::from(cargo_target_dir);
        paths.push(base.join(format!("deploy/{name}.so")));
        paths.push(base.join(format!("sbpf-solana-solana/release/{name}.so")));
        paths.push(base.join(format!("sbpf-solana-solana/release/deps/{name}.so")));
    }
    let workspace_target = manifest_dir.join("../../target");
    paths.push(workspace_target.join(format!("deploy/{name}.so")));
    paths.push(workspace_target.join(format!("sbpf-solana-solana/release/{name}.so")));
    paths.push(workspace_target.join(format!("sbpf-solana-solana/release/deps/{name}.so")));
    paths
}

impl TestContext {
    pub fn new() -> Self {
        let program_id = phygital_token::ID;
        // Sigverify off so secp256r1 precompile tests can submit without real ed25519
        // signatures on some paths; admin ops still use real keypairs below.
        let mut svm = LiteSVM::new().with_precompiles().with_sigverify(false);
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        Self::deploy_program(
            &mut svm,
            program_id,
            &program_artifact_paths(manifest_dir, "phygital_token"),
            "phygital_token",
        );

        let admin = Keypair::new();
        let issuer = Keypair::new();
        let minter = Keypair::new();
        for kp in [&admin, &issuer, &minter] {
            svm.airdrop(&kp.pubkey(), 10 * LAMPORTS_PER_SOL)
                .expect("airdrop role key");
        }

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10 * LAMPORTS_PER_SOL)
            .expect("airdrop payer");

        let mut ctx = Self {
            svm,
            payer,
            admin,
            issuer,
            minter,
            program_id,
        };
        ctx.bootstrap_admin_config();
        ctx
    }

    fn deploy_program(
        svm: &mut LiteSVM,
        program_id: Pubkey,
        candidates: &[std::path::PathBuf],
        name: &str,
    ) {
        let bytes = candidates
            .iter()
            .find_map(|path| std::fs::read(path).ok())
            .unwrap_or_else(|| {
                panic!(
                    "{name} artifact not found. run `anchor build` first. tried: {}",
                    candidates
                        .iter()
                        .map(|path| path.display().to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            });
        svm.add_program(program_id, &bytes)
            .unwrap_or_else(|err| panic!("deploy {name}: {err:?}"));
    }

    pub fn phygital_token_pda(&self, secp256r1_pubkey: &Secp256r1Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[PHYGITAL_TOKEN_SEED, secp256r1_pda_seed(secp256r1_pubkey)],
            &self.program_id,
        )
        .0
    }

    pub fn admin_config_pda(&self) -> Pubkey {
        Pubkey::find_program_address(&[ADMIN_CONFIG_SEED], &self.program_id).0
    }

    pub fn wallet_pda(&self, phygital_token: Pubkey) -> Pubkey {
        self.token_pda(WALLET_SEED, phygital_token)
    }

    pub fn policy_pda(&self, phygital_token: Pubkey) -> Pubkey {
        self.token_pda(POLICY_SEED, phygital_token)
    }

    fn token_pda(&self, seed: &[u8], phygital_token: Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[seed, phygital_token.as_ref()], &self.program_id).0
    }

    /// The token's accessory policy, if one exists.
    pub fn policy(&self, phygital_token: Pubkey) -> Option<AccessoryPolicy> {
        let account = self.svm.get_account(&self.policy_pda(phygital_token))?;
        if account.owner != self.program_id || account.data.is_empty() {
            return None;
        }
        Some(
            AccessoryPolicy::try_deserialize(&mut account.data.as_ref())
                .expect("deserialize policy"),
        )
    }

    // --- admin config --------------------------------------------------------

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

    fn bootstrap_admin_config(&mut self) {
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
                policy: self.policy_pda(phygital_token),
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

    // --- phygital_token state readers -------------------------------------------------

    fn load_phygital_token(&self, phygital_token: Pubkey) -> PhygitalToken {
        let account = self
            .svm
            .get_account(&phygital_token)
            .expect("phygital_token account");
        PhygitalToken::try_deserialize(&mut account.data.as_ref())
            .expect("deserialize phygital_token")
    }

    pub fn phygital_token_owner(&self, phygital_token: Pubkey) -> Pubkey {
        self.load_phygital_token(phygital_token).owner
    }

    pub fn phygital_token_lock_state(&self, phygital_token: Pubkey) -> bool {
        self.load_phygital_token(phygital_token).is_locked()
    }

    pub fn last_sign_count(&self, phygital_token: Pubkey) -> u32 {
        self.load_phygital_token(phygital_token).last_sign_count
    }

    pub fn phygital_token_mint(&self, phygital_token: Pubkey) -> Pubkey {
        self.load_phygital_token(phygital_token).mint
    }

    /// Next WebAuthn signCount to use for a successful assertion against `phygital_token`.
    pub fn next_sign_count(&self, phygital_token: Pubkey) -> u32 {
        self.load_phygital_token(phygital_token)
            .last_sign_count
            .saturating_add(1)
    }

    pub fn phygital_token_account(&self, phygital_token: Pubkey) -> PhygitalToken {
        self.load_phygital_token(phygital_token)
    }

    // --- initialize ----------------------------------------------------------

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

    // --- verify --------------------------------------------------------------

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

    // --- set_owner ----------------------------------------------------

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
                policy: self.policy_pda(phygital_token),
                wallet: self.wallet_pda(phygital_token),
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

    // --- assign_mint ---------------------------------------------------------

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

    // --- remove_owner ----------------------------------------------------

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

    // --- wallet / accessory policy --------------------------------------------

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

    fn wallet_ix(
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

    fn accessory_accounts(&self, phygital_token: Pubkey) -> Vec<AccountMeta> {
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
            .verify_secp256r1_instruction(challenge, self.next_sign_count(token));
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

    // --- slot control --------------------------------------------------------

    pub fn set_current_slot(&mut self, slot: u64) {
        use solana_slot_hashes::SlotHashes;

        self.svm.warp_to_slot(slot);
        let hash = solana_message::Hash::new_from_array([slot as u8; 32]);
        self.svm.set_sysvar(&SlotHashes::new(&[(slot, hash)]));
    }

    // --- low-level tx submission ---------------------------------------------

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

/// Policy entry allowing every instruction of `program_id`.
pub fn allow(program_id: Pubkey) -> PolicyAction {
    PolicyAction::SetProgramPermission(ProgramPermission {
        program_id,
        access: ProgramAccess::AllInstructions,
    })
}

/// SOL cap of `lamports` per lifetime.
pub fn sol_cap(lamports: u64) -> PolicyAction {
    PolicyAction::SetSolCap(Some(phygital_token::CapArg {
        cap: lamports,
        ..Default::default()
    }))
}
