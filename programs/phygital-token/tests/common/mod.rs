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
use phygital_token::constants::{ASSET_SEED, INITIALIZE_AUTHORITY};
use phygital_token::state::Asset;
use phygital_token::utils::secp256r1_pda_seed;
use phygital_token::{AssetType, InitializeArgs, Secp256r1Pubkey, Secp256r1VerifyArgs};
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
//   Asset      = asset PDA created by `initialize` (1:1 with a passkey)
//   Owner      = asset.owner (current custodian; `Pubkey::default()` when unowned)
//
// The token has no on-chain Token-2022 mint: ownership lives entirely in the
// `Asset` PDA and is moved by `execute_transfer` after a secp256r1/WebAuthn proof.

/// A freshly `initialize`d asset plus the passkey that controls its transfers.
///
/// `identifier` is a chip binding field stored on the asset. The PDA is seeded
/// by `passkey`'s public key (which also authorizes transfers).
pub struct MintedAsset {
    pub asset: Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub passkey: TestPasskey,
}

/// Generate a unique chip identifier, distinct from any passkey public key.
/// Stored on the asset for binding; not used as the PDA seed.
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

        svm.airdrop(&INITIALIZE_AUTHORITY, 10 * LAMPORTS_PER_SOL)
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

    pub fn asset_pda(&self, secp256r1_pubkey: &Secp256r1Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[ASSET_SEED, secp256r1_pda_seed(secp256r1_pubkey)],
            &self.program_id,
        )
        .0
    }

    // --- asset state readers -------------------------------------------------

    fn load_asset(&self, asset: Pubkey) -> Asset {
        let account = self.svm.get_account(&asset).expect("asset account");
        Asset::try_deserialize(&mut account.data.as_ref()).expect("deserialize asset")
    }

    pub fn asset_owner(&self, asset: Pubkey) -> Pubkey {
        self.load_asset(asset).owner
    }

    pub fn asset_lock_state(&self, asset: Pubkey) -> bool {
        self.load_asset(asset).is_locked
    }

    pub fn last_sign_count(&self, asset: Pubkey) -> u32 {
        self.load_asset(asset).last_sign_count
    }

    /// Next WebAuthn signCount to use for a successful assertion against `asset`.
    pub fn next_sign_count(&self, asset: Pubkey) -> u32 {
        self.load_asset(asset).last_sign_count.saturating_add(1)
    }

    pub fn asset_account(&self, asset: Pubkey) -> Asset {
        self.load_asset(asset)
    }

    // --- initialize ----------------------------------------------------------

    pub fn initialize_ix(
        &self,
        authority: Pubkey,
        asset: Pubkey,
        args: InitializeArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::Initialize {
                authority,
                asset,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::Initialize { args }.data(),
        }
    }

    /// Create a transferable asset controlled by `passkey`.
    pub fn init_asset(&mut self, passkey: &TestPasskey) -> MintedAsset {
        self.init_asset_of_type(passkey, AssetType::Transferable)
    }

    /// Create an asset of the given type (`Lockable` or `Transferable`).
    pub fn init_asset_of_type(
        &mut self,
        passkey: &TestPasskey,
        asset_type: AssetType,
    ) -> MintedAsset {
        self.init_asset_with_identifier(unique_identifier(), passkey, asset_type)
    }

    /// Create an asset with an explicit chip `identifier` (binding field) and a
    /// `passkey` whose public key seeds the PDA and authorizes transfers.
    pub fn init_asset_with_identifier(
        &mut self,
        identifier: Secp256r1Pubkey,
        passkey: &TestPasskey,
        asset_type: AssetType,
    ) -> MintedAsset {
        let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
        let asset = self.asset_pda(&secp256r1_pubkey);
        let args = InitializeArgs {
            identifier,
            secp256r1_pubkey,
            asset_type,
        };
        let ix = self.initialize_ix(INITIALIZE_AUTHORITY, asset, args);
        Self::send_instruction_as(
            &mut self.svm,
            ix,
            INITIALIZE_AUTHORITY,
        )
        .expect("initialize asset");

        MintedAsset {
            asset,
            identifier,
            passkey: passkey.clone(),
        }
    }

    // --- verify_asset --------------------------------------------------------

    pub fn verify_asset_ix(
        &self,
        asset: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        message_hash: [u8; 32],
        expected_rp_id: Option<String>,
        expected_origin: Option<String>,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::VerifyAsset {
                asset,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::VerifyAsset {
                secp256r1_verify_args,
                message_hash,
                expected_rp_id,
                expected_origin,
            }
            .data(),
        }
    }

    pub fn send_verify_asset(
        &mut self,
        asset: &MintedAsset,
        message_hash: [u8; 32],
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        self.send_verify_asset_with_bindings(asset, message_hash, include_secp_ix, None, None, None)
    }

    pub fn send_verify_asset_with_bindings(
        &mut self,
        asset: &MintedAsset,
        message_hash: [u8; 32],
        include_secp_ix: bool,
        sign_count: Option<u32>,
        expected_rp_id: Option<String>,
        expected_origin: Option<String>,
    ) -> litesvm::types::TransactionResult {
        let sign_count = sign_count.unwrap_or_else(|| self.next_sign_count(asset.asset));

        let (secp_ix, verify_args) = asset
            .passkey
            .verify_asset_secp256r1_instruction(message_hash, sign_count);
        let verify_ix = self.verify_asset_ix(
            asset.asset,
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

    // --- execute_transfer ----------------------------------------------------

    pub fn execute_transfer_ix(
        &self,
        recipient: Pubkey,
        asset: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::ExecuteTransfer {
                recipient,
                asset,
                slot_hashes: SLOT_HASHES_SYSVAR_ID,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::ExecuteTransfer {
                secp256r1_verify_args,
                slot_number,
            }
            .data(),
        }
    }

    pub fn send_execute_transfer(
        &mut self,
        asset: &MintedAsset,
        recipient: &Keypair,
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        self.send_execute_transfer_at_slot(asset, recipient, include_secp_ix, None, None, None)
    }

    pub fn send_execute_transfer_at_slot(
        &mut self,
        asset: &MintedAsset,
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
        let sign_count = sign_count.unwrap_or_else(|| self.next_sign_count(asset.asset));

        let (secp_ix, verify_args) =
            asset
                .passkey
                .secp256r1_verify_instruction(asset.asset, slot_hash, sign_count);

        let transfer_ix =
            self.execute_transfer_ix(recipient.pubkey(), asset.asset, verify_args, slot_number);

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
    pub fn send_execute_transfer_with_instructions(
        &mut self,
        instructions: Vec<Instruction>,
        signers: &[&Keypair],
    ) -> litesvm::types::TransactionResult {
        Self::send_instructions(&mut self.svm, &instructions, signers)
    }

    // --- set_lock_state ------------------------------------------------------

    pub fn set_lock_state_ix(&self, owner: Pubkey, asset: Pubkey, is_locked: bool) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::SetLockState { owner, asset }
                .to_account_metas(None),
            data: phygital_token::instruction::SetLockState { is_locked }.data(),
        }
    }

    // --- remove_ownership ----------------------------------------------------

    pub fn remove_ownership_ix(&self, owner: Pubkey, asset: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::RemoveOwnership { owner, asset }
                .to_account_metas(None),
            data: phygital_token::instruction::RemoveOwnership {}.data(),
        }
    }

    pub fn send_remove_ownership(
        &mut self,
        asset: &MintedAsset,
        owner: &Keypair,
    ) -> litesvm::types::TransactionResult {
        let ix = self.remove_ownership_ix(owner.pubkey(), asset.asset);
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
        let blockhash = svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[instruction], Some(&payer), &blockhash);
        let tx = VersionedTransaction {
            signatures: vec![Signature::default(); msg.header.num_required_signatures as usize],
            message: VersionedMessage::Legacy(msg),
        };
        let result = svm.send_transaction(tx);
        svm.expire_blockhash();
        result
    }
}
