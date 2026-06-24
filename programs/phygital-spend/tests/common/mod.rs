#[path = "../../../phygital-token/tests/common/mod.rs"]
mod token_common;

pub use token_common::*;
pub use solana_signer::Signer;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_2022::spl_token_2022::instruction::{approve_checked, mint_to};
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use litesvm::types::TransactionResult;
use phygital_token::AssetType;
use phygital_token::Secp256r1VerifyArgs as TokenSecp256r1VerifyArgs;
use solana_keypair::Keypair;
use solana_sdk_ids::sysvar::{
    instructions::ID as INSTRUCTIONS_SYSVAR_ID, slot_hashes::ID as SLOT_HASHES_SYSVAR_ID,
};

pub const SPEND_DELEGATE_AMOUNT: u64 = 10;

pub struct SpendMint {
    pub mint: Pubkey,
    pub authority: Keypair,
}

pub struct SpendFixture {
    pub asset: MintedAsset,
    pub holder: Keypair,
    pub spend_mint: SpendMint,
    pub spend_amount: u64,
}

fn deploy_spend_program(ctx: &mut TestContext) {
    let program_id = phygital_spend::ID;
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();
    if let Ok(cargo_target_dir) = std::env::var("CARGO_TARGET_DIR") {
        let base = std::path::PathBuf::from(cargo_target_dir);
        candidates.push(base.join("deploy/phygital_spend.so"));
        candidates.push(base.join("sbpf-solana-solana/release/phygital_spend.so"));
        candidates.push(base.join("sbpf-solana-solana/release/deps/phygital_spend.so"));
    }
    let workspace_target = manifest_dir.join("../../target");
    candidates.push(workspace_target.join("deploy/phygital_spend.so"));
    candidates.push(workspace_target.join("sbpf-solana-solana/release/phygital_spend.so"));
    candidates.push(workspace_target.join("sbpf-solana-solana/release/deps/phygital_spend.so"));

    let bytes = candidates
        .iter()
        .find_map(|path| std::fs::read(path).ok())
        .unwrap_or_else(|| {
            panic!(
                "phygital_spend artifact not found. run `anchor build` first. tried: {}",
                candidates
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        });
    ctx.svm
        .add_program(program_id, &bytes)
        .unwrap_or_else(|err| panic!("deploy phygital_spend: {err:?}"));
}

impl TestContext {
    pub fn new_for_spend() -> Self {
        let mut ctx = Self::new();
        deploy_spend_program(&mut ctx);
        ctx
    }

    pub fn spend_authority(&self, asset: Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[phygital_spend::SPEND_AUTHORITY_SEED, asset.as_ref()],
            &phygital_spend::ID,
        )
        .0
    }

    pub fn create_spend_mint(&mut self) -> SpendMint {
        let mint = Keypair::new();
        let authority = Keypair::new();
        use anchor_lang::solana_program::program_pack::Pack;
        use anchor_lang::solana_program::system_instruction;
        use anchor_spl::token_2022::spl_token_2022::instruction::initialize_mint2;
        use anchor_spl::token_2022::spl_token_2022::state::Mint;

        let rent: Rent = self.svm.get_sysvar();
        let rent_lamports = rent.minimum_balance(Mint::LEN);
        self.svm
            .airdrop(&authority.pubkey(), LAMPORTS_PER_SOL)
            .unwrap();

        let create_ix = system_instruction::create_account(
            &self.payer.pubkey(),
            &mint.pubkey(),
            rent_lamports,
            Mint::LEN as u64,
            &TOKEN_2022_ID,
        );
        Self::send_instruction(&mut self.svm, create_ix, &[&self.payer, &mint])
            .expect("create spend mint");
        let init_ix = initialize_mint2(
            &TOKEN_2022_ID,
            &mint.pubkey(),
            &authority.pubkey(),
            None,
            0,
        )
        .expect("initialize spend mint");
        Self::send_instruction(&mut self.svm, init_ix, &[&authority])
            .expect("init spend mint");

        SpendMint {
            mint: mint.pubkey(),
            authority,
        }
    }

    pub fn create_holder_ata(&mut self, holder: Pubkey, mint: Pubkey) -> Pubkey {
        let ix = self.create_recipient_ata_ix(self.payer.pubkey(), holder, mint);
        Self::send_instruction(&mut self.svm, ix, &[&self.payer])
            .expect("create holder ata");
        get_associated_token_address_with_program_id(&holder, &mint, &TOKEN_2022_ID)
    }

    pub fn mint_spend_tokens(
        &mut self,
        spend_mint: &SpendMint,
        holder: Pubkey,
        amount: u64,
    ) -> Pubkey {
        let ata = self.create_holder_ata(holder, spend_mint.mint);
        let ix = mint_to(
            &TOKEN_2022_ID,
            &spend_mint.mint,
            &ata,
            &spend_mint.authority.pubkey(),
            &[],
            amount,
        )
        .expect("mint_to");
        Self::send_instruction(&mut self.svm, ix, &[&spend_mint.authority])
            .expect("mint spend tokens");
        ata
    }

    pub fn approve_spend_delegate(
        &mut self,
        holder: &Keypair,
        asset: Pubkey,
        spend_mint: Pubkey,
        owner_token_account: Pubkey,
        amount: u64,
    ) {
        let delegate = self.spend_authority(asset);
        let ix = approve_checked(
            &TOKEN_2022_ID,
            &owner_token_account,
            &spend_mint,
            &delegate,
            &holder.pubkey(),
            &[],
            amount,
            0,
        )
        .expect("approve_checked");
        Self::send_instruction(&mut self.svm, ix, &[holder]).expect("approve delegate");
    }

    pub fn setup_spend_fixture(&mut self, spend_amount: u64) -> SpendFixture {
        let passkey = TestPasskey::generate();
        let asset = self.mint_asset_with_passkey_and_lock(&passkey, AssetType::Lockable);
        let holder = Keypair::new();
        let (claim_slot, _) = current_slot_entry(&self.svm);
        self.send_execute_transfer(&asset, &holder, true)
            .expect("claim locked asset");
        self.set_current_slot(claim_slot.saturating_add(1));

        let spend_mint = self.create_spend_mint();
        self.mint_spend_tokens(&spend_mint, holder.pubkey(), spend_amount);
        self.approve_spend_delegate(
            &holder,
            asset.asset,
            spend_mint.mint,
            get_associated_token_address_with_program_id(
                &holder.pubkey(),
                &spend_mint.mint,
                &TOKEN_2022_ID,
            ),
            spend_amount,
        );

        SpendFixture {
            asset: MintedAsset {
                passkey,
                recipient: holder.insecure_clone(),
                ..asset
            },
            holder,
            spend_mint,
            spend_amount,
        }
    }

    pub fn spend_verify_message(
        &self,
        recipient: &Pubkey,
        spend_mint: &Pubkey,
        amount: u64,
    ) -> Vec<u8> {
        phygital_spend::build_spend_verify_message(recipient, spend_mint, amount)
    }

    pub fn execute_spend_ix(
        &self,
        asset: Pubkey,
        owner: Pubkey,
        spend_mint: Pubkey,
        owner_token_account: Pubkey,
        recipient: Pubkey,
        recipient_token_account: Pubkey,
        secp256r1_verify_args: TokenSecp256r1VerifyArgs,
        amount: u64,
    ) -> Instruction {
        let secp256r1_verify_args = phygital_spend::Secp256r1VerifyArgs {
            signed_message_index: secp256r1_verify_args.signed_message_index,
            slot_number: secp256r1_verify_args.slot_number,
            client_data_json: secp256r1_verify_args.client_data_json,
        };
        Instruction {
            program_id: phygital_spend::ID,
            accounts: phygital_spend::accounts::ExecuteSpend {
                asset,
                owner,
                mint: spend_mint,
                owner_token_account,
                recipient,
                recipient_token_account,
                spend_authority: self.spend_authority(asset),
                phygital_token_program: self.program_id,
                slot_hashes: SLOT_HASHES_SYSVAR_ID,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
                token_program: TOKEN_2022_ID,
            }
            .to_account_metas(None),
            data: phygital_spend::instruction::ExecuteSpend {
                secp256r1_verify_args,
                amount,
            }
            .data(),
        }
    }

    pub fn send_execute_spend(
        &mut self,
        fixture: &SpendFixture,
        recipient: &Keypair,
        amount: u64,
        include_secp_ix: bool,
    ) -> TransactionResult {
        let last_slot = self.last_transfer_slot(fixture.asset.asset);
        let (current_slot, _) = current_slot_entry(&self.svm);
        let spend_slot = current_slot.max(last_slot.saturating_add(1));
        if spend_slot > current_slot {
            self.set_current_slot(spend_slot);
        }
        let (slot_number, slot_hash) = current_slot_entry(&self.svm);
        let message =
            self.spend_verify_message(&recipient.pubkey(), &fixture.spend_mint.mint, amount);
        let (secp_ix, verify_args) = fixture.asset.passkey.verify_asset_secp256r1_instruction(
            message,
            slot_number,
            slot_hash,
        );

        let owner_ata = get_associated_token_address_with_program_id(
            &fixture.holder.pubkey(),
            &fixture.spend_mint.mint,
            &TOKEN_2022_ID,
        );
        let recipient_ata = get_associated_token_address_with_program_id(
            &recipient.pubkey(),
            &fixture.spend_mint.mint,
            &TOKEN_2022_ID,
        );

        let spend_ix = self.execute_spend_ix(
            fixture.asset.asset,
            fixture.holder.pubkey(),
            fixture.spend_mint.mint,
            owner_ata,
            recipient.pubkey(),
            recipient_ata,
            verify_args,
            amount,
        );

        let instructions = if include_secp_ix {
            vec![secp_ix, spend_ix]
        } else {
            vec![spend_ix]
        };

        self.svm
            .airdrop(&recipient.pubkey(), LAMPORTS_PER_SOL)
            .ok();
        let payer = &self.payer;
        let create_ata_ix = self.create_recipient_ata_ix(
            payer.pubkey(),
            recipient.pubkey(),
            fixture.spend_mint.mint,
        );
        Self::send_instruction(&mut self.svm, create_ata_ix, &[payer])
            .expect("create recipient ata");

        Self::send_instructions(&mut self.svm, &instructions, &[payer])
    }
}

pub fn assert_spend_error(result: TransactionResult, expected_name: &str) {
    let err = result.expect_err("expected transaction to fail");
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains(expected_name),
        "expected error {expected_name}, got: {err:?}"
    );
}
