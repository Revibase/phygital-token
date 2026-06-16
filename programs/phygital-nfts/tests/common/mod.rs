mod assertions;
mod external_group_mint;
mod plain_token_mint;
mod secp256r1;

pub use assertions::{assert_token_program_error, assert_transaction_failed};
pub use external_group_mint::{
    create_external_group_mint, create_group_mint_without_update_authority, ExternalGroupMint,
};
pub use plain_token_mint::create_plain_token2022_mint;

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::{prelude::*, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::associated_token::ID as ASSOCIATED_TOKEN_ID;
use anchor_spl::token_2022::spl_token_2022::instruction::transfer_checked;
use anchor_spl::token_2022::spl_token_2022::state::Account as TokenAccountState;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use litesvm::LiteSVM;
use phygital_nfts::constants::{
    ADMIN, CARD_INSTANCE_SEED, PROGRAM_AUTHORITY_SEED,
};
use phygital_nfts::state::CardInstance;
use phygital_nfts::utils::secp256r1_pda_seed;
use phygital_nfts::{CreateMintArgs, MintTokenArgs, Secp256r1Pubkey, Secp256r1VerifyArgs};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_sdk_ids::sysvar::{
    instructions::ID as INSTRUCTIONS_SYSVAR_ID, slot_hashes::ID as SLOT_HASHES_SYSVAR_ID,
};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub use secp256r1::{current_slot_entry, TestPasskey};

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const TEST_RP_ID: &str = "localhost";
pub const TEST_ORIGIN: &str = "http://localhost:3000";

pub struct MintedCard {
    pub collection_owner: Keypair,
    pub holder: Keypair,
    pub mint: Pubkey,
    pub card_instance: Pubkey,
    pub group_mint: Pubkey,
    pub passkey: TestPasskey,
}

pub struct TestContext {
    pub svm: LiteSVM,
    pub payer: Keypair,
    pub program_id: Pubkey,
    pub transfer_hook_program_id: Pubkey,
}

fn program_artifact_paths(manifest_dir: &std::path::Path, name: &str) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if let Ok(cargo_target_dir) = std::env::var("CARGO_TARGET_DIR") {
        let base = std::path::PathBuf::from(cargo_target_dir);
        paths.push(base.join(format!("deploy/{name}.so")));
        paths.push(
            base.join(format!("sbpf-solana-solana/release/{name}.so")),
        );
        paths.push(
            base.join(format!("sbpf-solana-solana/release/deps/{name}.so")),
        );
    }
    let workspace_target = manifest_dir.join("../../target");
    paths.push(workspace_target.join(format!("deploy/{name}.so")));
    paths.push(
        workspace_target.join(format!("sbpf-solana-solana/release/{name}.so")),
    );
    paths.push(
        workspace_target.join(format!("sbpf-solana-solana/release/deps/{name}.so")),
    );
    paths
}

impl TestContext {
    pub fn new() -> Self {
        let program_id = phygital_nfts::ID;
        let transfer_hook_program_id = phygital_nfts_hook::ID;
        let mut svm = LiteSVM::new().with_precompiles();
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        Self::deploy_program(
            &mut svm,
            program_id,
            &program_artifact_paths(manifest_dir, "phygital_nfts"),
            "phygital_nfts",
        );
        Self::deploy_program(
            &mut svm,
            transfer_hook_program_id,
            &program_artifact_paths(manifest_dir, "phygital_nfts_hook"),
            "phygital_nfts_hook",
        );

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10 * LAMPORTS_PER_SOL)
            .expect("airdrop payer");

        Self {
            svm,
            payer,
            program_id,
            transfer_hook_program_id,
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

    pub fn program_authority(&self) -> Pubkey {
        Pubkey::find_program_address(&[PROGRAM_AUTHORITY_SEED], &self.program_id).0
    }

    pub fn card_instance_pda(&self, secp256r1_pubkey: &Secp256r1Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[CARD_INSTANCE_SEED, secp256r1_pda_seed(secp256r1_pubkey)],
            &self.program_id,
        )
        .0
    }

    pub fn fund_program_authority_ix(&self, from: Pubkey, amount: u64) -> Instruction {
        system_instruction::transfer(&from, &self.program_authority(), amount)
    }

    pub fn fund_program_authority(&mut self, amount: Option<u64>) {
        let amount = amount.unwrap_or_else(|| self.expected_rent_pool_target());
        let payer = &self.payer;
        let ix = self.fund_program_authority_ix(payer.pubkey(), amount);
        Self::send_instruction(&mut self.svm, ix, &[payer]).expect("fund program authority");
    }

    pub fn program_authority_lamports(&self) -> u64 {
        self.svm
            .get_account(&self.program_authority())
            .map(|account| account.lamports)
            .unwrap_or(0)
    }

    pub fn token_account_rent(&self) -> u64 {
        use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
        use anchor_spl::token_2022::spl_token_2022::state::Account as SplTokenAccount;

        let len = ExtensionType::try_calculate_account_len::<SplTokenAccount>(&[
            ExtensionType::ImmutableOwner,
            ExtensionType::TransferHookAccount,
        ])
        .expect("design mint token account len");
        let rent: Rent = self.svm.get_sysvar();
        rent.minimum_balance(len)
    }

    /// Rent for a Token-2022 recipient ATA on a design mint (same as `token_account_rent`).
    pub fn recipient_ata_rent(&self) -> u64 {
        self.token_account_rent()
    }

    pub fn mint_until_transfer_rent_funded(&mut self, card: &MintedCard) {
        while self.program_authority_lamports() < self.recipient_ata_rent() {
            self.mint_second_card_same_design(card, &TestPasskey::generate());
        }
    }

    pub fn custody_ata(&self, mint: Pubkey) -> Pubkey {
        get_associated_token_address_with_program_id(
            &self.program_authority(),
            &mint,
            &TOKEN_2022_ID,
        )
    }

    pub fn card_instance_fields(&self, card_instance: Pubkey) -> (Pubkey, Pubkey, u64) {
        let account = self
            .svm
            .get_account(&card_instance)
            .expect("card instance account");
        let instance = CardInstance::try_deserialize(&mut account.data.as_ref())
            .expect("deserialize card instance");
        (
            instance.owner,
            instance.mint,
            instance.last_transfer_slot,
        )
    }

    pub fn recipient_close_authority(&self, recipient: Pubkey, mint: Pubkey) -> Option<Pubkey> {
        use anchor_lang::solana_program::program_option::COption;
        use anchor_spl::token_2022::spl_token_2022::extension::StateWithExtensions;

        let ata = get_associated_token_address_with_program_id(&recipient, &mint, &TOKEN_2022_ID);
        let account = self.svm.get_account(&ata)?;
        let state = StateWithExtensions::<TokenAccountState>::unpack(&account.data).ok()?;
        match state.base.close_authority {
            COption::Some(pk) => Some(pk),
            COption::None => None,
        }
    }

    pub fn create_mint_ix(
        &self,
        payer: Pubkey,
        owner: Pubkey,
        group_mint_authority: Pubkey,
        mint: Pubkey,
        group_mint: Pubkey,
        args: CreateMintArgs,
    ) -> Instruction {
        let accounts = phygital_nfts::accounts::CreateMint {
            payer,
            owner,
            group_mint,
            group_mint_authority,
            mint,
            program_authority: self.program_authority(),
            token_program: TOKEN_2022_ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None);
        Instruction {
            program_id: self.program_id,
            accounts,
            data: phygital_nfts::instruction::CreateMint { args }.data(),
        }
    }

    pub fn create_design(
        svm: &mut LiteSVM,
        program_id: Pubkey,
        payer: &Keypair,
        owner: &Keypair,
        group: &ExternalGroupMint,
        mint_args: CreateMintArgs,
    ) -> Pubkey {
        let program_authority =
            Pubkey::find_program_address(&[PROGRAM_AUTHORITY_SEED], &program_id).0;
        let group_mint = group.mint.pubkey();
        // The mint is now a caller-provided keypair rather than a PDA.
        let mint = Keypair::new();

        let accounts = phygital_nfts::accounts::CreateMint {
            payer: payer.pubkey(),
            owner: owner.pubkey(),
            group_mint,
            group_mint_authority: group.authority.pubkey(),
            mint: mint.pubkey(),
            program_authority,
            token_program: TOKEN_2022_ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None);
        let ix = Instruction {
            program_id,
            accounts,
            data: phygital_nfts::instruction::CreateMint { args: mint_args }.data(),
        };
        Self::send_instruction(svm, ix, &[payer, owner, &group.authority, &mint])
            .expect("create design mint");
        mint.pubkey()
    }

    pub fn execute_transfer_ix(
        &self,
        recipient: Pubkey,
        sender: Pubkey,
        card_instance: Pubkey,
        mint: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
    ) -> Instruction {
        self.execute_transfer_ix_with_hook(
            recipient,
            sender,
            card_instance,
            mint,
            secp256r1_verify_args,
            self.transfer_hook_program_id,
        )
    }

    pub fn execute_transfer_ix_with_hook(
        &self,
        recipient: Pubkey,
        sender: Pubkey,
        card_instance: Pubkey,
        mint: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        transfer_hook_program: Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::ExecuteTransfer {
                recipient,
                sender,
                card_instance,
                mint: mint,
                sender_token_account: get_associated_token_address_with_program_id(
                    &sender,
                    &mint,
                    &TOKEN_2022_ID,
                ),
                recipient_token_account: get_associated_token_address_with_program_id(
                    &recipient,
                    &mint,
                    &TOKEN_2022_ID,
                ),
                program_authority: self.program_authority(),
                slot_hashes: SLOT_HASHES_SYSVAR_ID,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
                token_program: TOKEN_2022_ID,
                associated_token_program: ASSOCIATED_TOKEN_ID,
                system_program: anchor_lang::solana_program::system_program::ID,
                transfer_hook_program,
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::ExecuteTransfer {
                secp256r1_verify_args,
            }
            .data(),
        }
    }

    pub fn create_recipient_ata_ix(
        &self,
        payer: Pubkey,
        owner: Pubkey,
        mint: Pubkey,
    ) -> Instruction {
        anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
            &payer,
            &owner,
            &mint,
            &TOKEN_2022_ID,
        )
    }

    pub fn owner_transfer_checked_ix(
        &self,
        owner: Pubkey,
        mint: Pubkey,
        recipient: Pubkey,
    ) -> Instruction {
        let sender_ata =
            get_associated_token_address_with_program_id(&owner, &mint, &TOKEN_2022_ID);
        let recipient_ata =
            get_associated_token_address_with_program_id(&recipient, &mint, &TOKEN_2022_ID);
        transfer_checked(
            &TOKEN_2022_ID,
            &sender_ata,
            &mint,
            &recipient_ata,
            &owner,
            &[],
            1,
            0,
        )
        .expect("transfer_checked ix")
    }

    pub fn mint_card_with_passkey_without_fund(&mut self, passkey: &TestPasskey) -> MintedCard {
        self.mint_card_internal(passkey, false)
    }

    pub fn mint_card_with_passkey(&mut self, passkey: &TestPasskey) -> MintedCard {
        self.mint_card_internal(passkey, true)
    }

    fn mint_card_internal(&mut self, passkey: &TestPasskey, fund_authority: bool) -> MintedCard {
        let collection_owner = Keypair::new();
        let holder = Keypair::new();

        self.svm
            .airdrop(&collection_owner.pubkey(), 2 * LAMPORTS_PER_SOL)
            .unwrap();
        self.svm
            .airdrop(&holder.pubkey(), 2 * LAMPORTS_PER_SOL)
            .unwrap();

        let group = create_external_group_mint(
            &mut self.svm,
            &self.payer,
            "Test Collection",
            "TCOL",
            "https://example.com/collection.json",
            100,
        );
        let group_mint = group.mint.pubkey();

        let mint_args = sample_create_design_args();
        let mint = Self::create_design(
            &mut self.svm,
            self.program_id,
            &self.payer,
            &collection_owner,
            &group,
            mint_args,
        );

        if fund_authority {
            self.fund_program_authority(None);
        }

        let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
        let card_instance = self.card_instance_pda(&secp256r1_pubkey);
        let token_args = MintTokenArgs { secp256r1_pubkey };

        let token_ix = self.mint_token_ix(
            self.payer.pubkey(),
            card_instance,
            mint,
            token_args,
        );
        TestContext::send_instruction(&mut self.svm, token_ix, &[&self.payer])
            .expect("create token");

        MintedCard {
            collection_owner,
            holder,
            mint,
            card_instance,
            group_mint,
            passkey: passkey.clone(),
        }
    }

    pub fn mint_second_card_same_design(
        &mut self,
        card: &MintedCard,
        passkey: &TestPasskey,
    ) -> Pubkey {
        let secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);
        let card_instance = self.card_instance_pda(&secp256r1_pubkey);
        let token_args = MintTokenArgs { secp256r1_pubkey };

        let token_ix = self.mint_token_ix(
            self.payer.pubkey(),
            card_instance,
            card.mint,
            token_args,
        );
        TestContext::send_instruction(&mut self.svm, token_ix, &[&self.payer])
            .expect("create second token");
        card_instance
    }

    pub fn send_execute_transfer(
        &mut self,
        card: &MintedCard,
        recipient: &Keypair,
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        self.send_execute_transfer_from(
            card,
            self.program_authority(),
            recipient,
            include_secp_ix,
            None,
            None,
        )
    }

    pub fn send_execute_transfer_with_instructions(
        &mut self,
        instructions: Vec<Instruction>,
        signers: &[&Keypair],
    ) -> litesvm::types::TransactionResult {
        Self::send_instructions(&mut self.svm, &instructions, signers)
    }

    pub fn send_execute_transfer_from(
        &mut self,
        card: &MintedCard,
        sender: Pubkey,
        recipient: &Keypair,
        include_secp_ix: bool,
        slot_number: Option<u64>,
        slot_hash: Option<[u8; 32]>,
    ) -> litesvm::types::TransactionResult {
        let (slot_number, slot_hash) = match (slot_number, slot_hash) {
            (Some(slot), Some(hash)) => (slot, hash),
            _ => current_slot_entry(&self.svm),
        };

        let (secp_ix, verify_args) = card.passkey.secp256r1_verify_instruction(
            TOKEN_2022_ID,
            card.card_instance,
            sender,
            slot_number,
            slot_hash,
        );

        let transfer_ix = self.execute_transfer_ix(
            recipient.pubkey(),
            sender,
            card.card_instance,
            card.mint,
            verify_args,
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

    pub fn send_execute_transfer_for_mint(
        &mut self,
        card: &MintedCard,
        sender: Pubkey,
        recipient: &Keypair,
        mint: Pubkey,
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        let (slot_number, slot_hash) = current_slot_entry(&self.svm);

        let (secp_ix, verify_args) = card.passkey.secp256r1_verify_instruction(
            TOKEN_2022_ID,
            card.card_instance,
            sender,
            slot_number,
            slot_hash,
        );

        let transfer_ix = self.execute_transfer_ix(
            recipient.pubkey(),
            sender,
            card.card_instance,
            mint,
            verify_args,
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

    pub fn set_current_slot(&mut self, slot: u64) {
        use solana_slot_hashes::SlotHashes;

        self.svm.warp_to_slot(slot);
        let hash = solana_message::Hash::new_from_array([slot as u8; 32]);
        self.svm.set_sysvar(&SlotHashes::new(&[(slot, hash)]));
    }

    pub fn last_transfer_slot(&self, card_instance: Pubkey) -> u64 {
        let account = self
            .svm
            .get_account(&card_instance)
            .expect("card instance account");
        let instance = CardInstance::try_deserialize(&mut account.data.as_ref())
            .expect("deserialize card instance");
        instance.last_transfer_slot
    }

    pub fn token_balance(&self, owner: Pubkey, mint: Pubkey) -> u64 {
        use anchor_spl::token_2022::spl_token_2022::extension::StateWithExtensions;

        let ata = get_associated_token_address_with_program_id(&owner, &mint, &TOKEN_2022_ID);
        let Some(account) = self.svm.get_account(&ata) else {
            return 0;
        };
        let state = StateWithExtensions::<TokenAccountState>::unpack(&account.data)
            .expect("unpack token account");
        state.base.amount
    }

    pub fn sender_ata_exists(&self, owner: Pubkey, mint: Pubkey) -> bool {
        let ata = get_associated_token_address_with_program_id(&owner, &mint, &TOKEN_2022_ID);
        self.svm.get_account(&ata).is_some()
    }

    pub fn mint_token_ix(
        &self,
        payer: Pubkey,
        card_instance: Pubkey,
        mint: Pubkey,
        args: MintTokenArgs,
    ) -> Instruction {
        self.mint_token_ix_with_custody_ata(
            payer,
            card_instance,
            mint,
            self.custody_ata(mint),
            args,
        )
    }

    pub fn mint_token_ix_with_custody_ata(
        &self,
        payer: Pubkey,
        card_instance: Pubkey,
        mint: Pubkey,
        program_authority_token_account: Pubkey,
        args: MintTokenArgs,
    ) -> Instruction {
        let program_authority = self.program_authority();
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::MintToken {
                authority: payer,
                card_instance,
                mint,
                program_authority,
                program_authority_token_account,
                token_program: TOKEN_2022_ID,
                associated_token_program: ASSOCIATED_TOKEN_ID,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::MintToken { args }.data(),
        }
    }

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

    pub fn expected_rent_pool_target(&self) -> u64 {
        self.token_account_rent()
            .checked_mul(10)
            .expect("rent pool target")
    }
}

pub fn sample_create_design_args() -> CreateMintArgs {
    CreateMintArgs {
        name: "Test Design".to_string(),
        symbol: "TDES".to_string(),
        uri: "https://example.com/design.json".to_string(),
    }
}

pub const SAMPLE_CARD_URI: &str = "https://example.com/card.json";

pub fn unauthorized_payer() -> Keypair {
    Keypair::new()
}

pub fn admin_payer() -> Keypair {
    // ADMIN is a fixed pubkey — tests use the real admin keypair when gating lands.
    // For now this is a placeholder; #[ignore] tests document expected behavior.
    let _ = ADMIN;
    Keypair::new()
}

pub fn sample_mint_token_args() -> MintTokenArgs {
    MintTokenArgs {
        secp256r1_pubkey: Secp256r1Pubkey([0x02; 33]),
    }
}
