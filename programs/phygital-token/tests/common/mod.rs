// Shared test harness: each integration-test binary pulls in this module via
// `mod common;` and uses only a subset of the helpers, so per-binary dead-code
// warnings are expected and not meaningful here. Helpers return LiteSVM's large
// failure metadata as-is.
#![allow(dead_code, unused_imports, clippy::result_large_err)]

mod admin;
mod assertions;
mod assign_mint;
mod initialize;
mod merchant;
mod remove_owner;
mod secp256r1;
mod set_owner;
mod slots;
mod spend;
mod spl;
mod state;
mod tx;
mod verify;

pub use assertions::{assert_phygital_token_program_error, assert_transaction_failed};

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{prelude::*, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use phygital_token::{
    secp256r1_pda_seed, InitializeArgs, PhygitalToken, PhygitalTokenType, Secp256r1Pubkey,
    Secp256r1VerifyArgs, ADMIN_CONFIG_SEED, PHYGITAL_TOKEN_SEED,
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
pub use spend::{daily_limit, PaySetup, Payment};
pub use spl::{DECIMALS, SPL_TOKEN, TOKEN_2022};

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

        // A realistic wall clock (2026-10-14T01:00:00Z) for expiry and daily limits.
        let mut clock: Clock = svm.get_sysvar();
        clock.unix_timestamp = 1_791_939_600;
        svm.set_sysvar(&clock);

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

    pub fn spend_policy_pda(&self, phygital_token: Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[phygital_token::SPEND_POLICY_SEED, phygital_token.as_ref()],
            &self.program_id,
        )
        .0
    }
}
