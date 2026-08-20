// Shared test harness: each integration-test binary pulls in this module via
// `mod common;` and uses only a subset of the helpers, so per-binary dead-code
// warnings are expected and not meaningful here.
#![allow(dead_code, unused_imports)]

mod assertions;
mod secp256r1;

pub use assertions::{assert_token_program_error, assert_transaction_failed};

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{prelude::*, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use phygital_token::constants::{PHYGITAL_TOKEN_SEED, ADMIN};
use phygital_token::state::PhygitalToken;
use phygital_token::utils::secp256r1_pda_seed;
use phygital_token::{PhygitalTokenType, InitializeArgs, Secp256r1Pubkey, Secp256r1VerifyArgs};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_sdk_ids::sysvar::{
    instructions::ID as INSTRUCTIONS_SYSVAR_ID, slot_hashes::ID as SLOT_HASHES_SYSVAR_ID,
};
use solana_signature::Signature;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub use secp256r1::{current_slot_entry, TestPasskey};

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const TEST_RP_ID: &str = "localhost";
pub const TEST_ORIGIN: &str = "http://localhost:3000";

// Domain vocabulary (see GLOSSARY.md at repo root):
//   Token      = PhygitalToken PDA created by `initialize` (1:1 with a passkey)
//   Owner      = token.owner (current custodian; `Pubkey::default()` when unowned)
//   Mint       = optional SPL mint pubkey, set later via `set_mint` (default until then)
//
// Ownership lives in the PhygitalToken PDA and is moved by `transfer_ownership`
// after a secp256r1/WebAuthn proof. `set_mint` binds an SPL mint after init.

/// A freshly `initialize`d token plus the passkey that controls its transfers.
///
/// `identifier` is a chip binding field stored on the token. The PDA is seeded
/// by `passkey`'s public key (which also authorizes transfers).
pub struct MintedToken {
    pub token: Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub passkey: TestPasskey,
}

/// Generate a unique chip identifier, distinct from any passkey public key.
/// Stored on the token for binding; not used as the PDA seed.
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
        // Sigverify off so tests can submit `initialize` as INITIALIZE_AUTHORITY
        // without the mainnet private key. secp256r1 precompile checks still run.
        let mut svm = LiteSVM::new().with_precompiles().with_sigverify(false);
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        Self::deploy_program(
            &mut svm,
            program_id,
            &program_artifact_paths(manifest_dir, "phygital_token"),
            "phygital_token",
        );

        svm.airdrop(&ADMIN, 10 * LAMPORTS_PER_SOL)
            .expect("airdrop initialize authority");

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10 * LAMPORTS_PER_SOL)
            .expect("airdrop payer");

        Self {
            svm,
            payer,
            program_id,
        }
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

    pub fn token_pda(&self, secp256r1_pubkey: &Secp256r1Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[PHYGITAL_TOKEN_SEED, secp256r1_pda_seed(secp256r1_pubkey)],
            &self.program_id,
        )
        .0
    }

    // --- token state readers -------------------------------------------------

    fn load_token(&self, token: Pubkey) -> PhygitalToken {
        let account = self.svm.get_account(&token).expect("token account");
        PhygitalToken::try_deserialize(&mut account.data.as_ref()).expect("deserialize token")
    }

    pub fn token_owner(&self, token: Pubkey) -> Pubkey {
        self.load_token(token).owner
    }

    pub fn token_lock_state(&self, token: Pubkey) -> bool {
        self.load_token(token).is_locked
    }

    pub fn last_sign_count(&self, token: Pubkey) -> u32 {
        self.load_token(token).last_sign_count
    }

    pub fn token_mint(&self, token: Pubkey) -> Pubkey {
        self.load_token(token).mint
    }

    /// Next WebAuthn signCount to use for a successful assertion against `token`.
    pub fn next_sign_count(&self, token: Pubkey) -> u32 {
        self.load_token(token).last_sign_count.saturating_add(1)
    }

    pub fn token_account(&self, token: Pubkey) -> PhygitalToken {
        self.load_token(token)
    }

    // --- initialize ----------------------------------------------------------

    pub fn initialize_ix(
        &self,
        authority: Pubkey,
        token: Pubkey,
        args: InitializeArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::Initialize {
                authority,
                token,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::Initialize { args }.data(),
        }
    }

    /// Create a transferable token controlled by `passkey`.
    pub fn init_token(&mut self, passkey: &TestPasskey) -> MintedToken {
        self.init_token_of_type(passkey, PhygitalTokenType::Bearer)
    }

    /// Create a token of the given type (`Controlled` or `Bearer`).
    pub fn init_token_of_type(
        &mut self,
        passkey: &TestPasskey,
        token_type: PhygitalTokenType,
    ) -> MintedToken {
        self.init_token_with_identifier(unique_identifier(), passkey, token_type)
    }

    /// Create a token with an explicit chip `identifier` (binding field) and a
    /// `passkey` whose public key seeds the PDA and authorizes transfers.
    pub fn init_token_with_identifier(
        &mut self,
        identifier: Secp256r1Pubkey,
        passkey: &TestPasskey,
        token_type: PhygitalTokenType,
    ) -> MintedToken {
        let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
        let token = self.token_pda(&secp256r1_pubkey);
        let args = InitializeArgs {
            identifier,
            secp256r1_pubkey,
            token_type,
        };
        let ix = self.initialize_ix(ADMIN, token, args);
        Self::send_instruction_as(&mut self.svm, ix, ADMIN)
            .expect("initialize token");

        MintedToken {
            token,
            identifier,
            passkey: passkey.clone(),
        }
    }

    // --- verify --------------------------------------------------------------

    pub fn verify_ix(
        &self,
        token: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        message_hash: [u8; 32],
        expected_rp_id: Option<String>,
        expected_origin: Option<String>,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::Verify {
                token,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::Verify {
                secp256r1_verify_args,
                message_hash,
                expected_rp_id,
                expected_origin,
            }
            .data(),
        }
    }

    pub fn send_verify(
        &mut self,
        token: &MintedToken,
        message_hash: [u8; 32],
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        self.send_verify_with_bindings(token, message_hash, include_secp_ix, None, None, None)
    }

    pub fn send_verify_with_bindings(
        &mut self,
        token: &MintedToken,
        message_hash: [u8; 32],
        include_secp_ix: bool,
        sign_count: Option<u32>,
        expected_rp_id: Option<String>,
        expected_origin: Option<String>,
    ) -> litesvm::types::TransactionResult {
        let sign_count = sign_count.unwrap_or_else(|| self.next_sign_count(token.token));

        let (secp_ix, verify_args) = token
            .passkey
            .verify_secp256r1_instruction(message_hash, sign_count);
        let verify_ix = self.verify_ix(
            token.token,
            verify_args,
            message_hash,
            expected_rp_id,
            expected_origin,
        );

        let instructions = if include_secp_ix {
            vec![secp_ix, verify_ix]
        } else {
            vec![verify_ix]
        };

        let payer = self.payer.insecure_clone();
        Self::send_instructions(&mut self.svm, &instructions, &[&payer])
    }

    // --- transfer_ownership ----------------------------------------------------

    pub fn transfer_ownership_ix(
        &self,
        recipient: Pubkey,
        token: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::TransferOwnership {
                recipient,
                token,
                slot_hashes: SLOT_HASHES_SYSVAR_ID,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::TransferOwnership {
                secp256r1_verify_args,
                slot_number,
            }
            .data(),
        }
    }

    pub fn send_transfer_ownership(
        &mut self,
        token: &MintedToken,
        recipient: &Keypair,
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        self.send_transfer_ownership_at_slot(token, recipient, include_secp_ix, None, None, None)
    }

    pub fn send_transfer_ownership_at_slot(
        &mut self,
        token: &MintedToken,
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
        let sign_count = sign_count.unwrap_or_else(|| self.next_sign_count(token.token));

        let (secp_ix, verify_args) =
            token
                .passkey
                .secp256r1_verify_instruction(token.token, slot_hash, sign_count);

        let transfer_ix =
            self.transfer_ownership_ix(recipient.pubkey(), token.token, verify_args, slot_number);

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
    pub fn send_transfer_ownership_with_instructions(
        &mut self,
        instructions: Vec<Instruction>,
        signers: &[&Keypair],
    ) -> litesvm::types::TransactionResult {
        Self::send_instructions(&mut self.svm, &instructions, signers)
    }

    // --- set_mint ------------------------------------------------------------

    pub fn set_mint_ix(&self, authority: Pubkey, token: Pubkey, mint: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::SetMint { authority, token }
                .to_account_metas(None),
            data: phygital_token::instruction::SetMint { mint }.data(),
        }
    }

    pub fn send_set_mint(
        &mut self,
        token: Pubkey,
        mint: Pubkey,
    ) -> litesvm::types::TransactionResult {
        let ix = self.set_mint_ix(ADMIN, token, mint);
        Self::send_instruction_as(&mut self.svm, ix, ADMIN)
    }

    // --- set_lock_state ------------------------------------------------------

    pub fn set_lock_state_ix(&self, owner: Pubkey, token: Pubkey, is_locked: bool) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::SetLockState { owner, token }
                .to_account_metas(None),
            data: phygital_token::instruction::SetLockState { is_locked }.data(),
        }
    }

    // --- remove_ownership ----------------------------------------------------

    pub fn remove_ownership_ix(&self, owner: Pubkey, token: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::RemoveOwnership { owner, token }
                .to_account_metas(None),
            data: phygital_token::instruction::RemoveOwnership {}.data(),
        }
    }

    pub fn send_remove_ownership(
        &mut self,
        token: &MintedToken,
        owner: &Keypair,
    ) -> litesvm::types::TransactionResult {
        let ix = self.remove_ownership_ix(owner.pubkey(), token.token);
        Self::send_instruction(&mut self.svm, ix, &[owner])
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
