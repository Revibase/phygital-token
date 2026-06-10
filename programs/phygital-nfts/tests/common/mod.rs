mod secp256r1;

use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::{prelude::*, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::associated_token::ID as ASSOCIATED_TOKEN_ID;
use anchor_spl::token_2022::spl_token_2022::instruction::transfer_checked;
use anchor_spl::token_2022::spl_token_2022::state::Account as TokenAccountState;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use litesvm::LiteSVM;
use phygital_nfts::constants::{GROUP_MINT_SEED, PROGRAM_AUTHORITY_SEED};
use phygital_nfts::{CreateGroupTokenArgs, CreateTokenArgs, Secp256r1Pubkey, Secp256r1VerifyArgs};
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

pub struct MintedNft {
    pub collection_owner: Keypair,
    pub holder: Keypair,
    pub token_mint: Keypair,
    pub group_mint: Pubkey,
    pub passkey: TestPasskey,
}

pub struct TestContext {
    pub svm: LiteSVM,
    pub payer: Keypair,
    pub program_id: Pubkey,
    pub transfer_hook_program_id: Pubkey,
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
            &[
                manifest_dir.join("../../target/deploy/phygital_nfts.so"),
                manifest_dir.join("../../target/sbpf-solana-solana/release/phygital_nfts.so"),
                manifest_dir.join("../../target/sbpf-solana-solana/release/deps/phygital_nfts.so"),
            ],
            "phygital_nfts",
        );
        Self::deploy_program(
            &mut svm,
            transfer_hook_program_id,
            &[
                manifest_dir.join("../../target/deploy/phygital_nfts_hook.so"),
                manifest_dir.join("../../target/sbpf-solana-solana/release/phygital_nfts_hook.so"),
                manifest_dir
                    .join("../../target/sbpf-solana-solana/release/deps/phygital_nfts_hook.so"),
            ],
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

    pub fn group_mint_pda(&self, unique_id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[GROUP_MINT_SEED, &unique_id.to_le_bytes()],
            &self.program_id,
        )
        .0
    }

    /// Funds `program_authority` so it can pay for recipient ATA rent during transfers.
    pub fn fund_program_authority_ix(&self, from: Pubkey, amount: u64) -> Instruction {
        system_instruction::transfer(&from, &self.program_authority(), amount)
    }

    pub fn fund_program_authority(&mut self, amount: Option<u64>) {
        let amount = amount.unwrap_or_else(|| self.expected_rent_pool_target());
        let payer = &self.payer;
        let ix = self.fund_program_authority_ix(payer.pubkey(), amount);
        Self::send_instruction(&mut self.svm, ix, &[payer]).expect("fund program authority");
    }

    pub fn create_group_token_ix(
        &self,
        payer: Pubkey,
        owner: Pubkey,
        group_mint: Pubkey,
        args: CreateGroupTokenArgs,
    ) -> Instruction {
        let accounts = phygital_nfts::accounts::CreateGroupToken {
            payer,
            owner,
            group_mint,
            program_authority: self.program_authority(),
            token_program: TOKEN_2022_ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None);
        Instruction {
            program_id: self.program_id,
            accounts,
            data: phygital_nfts::instruction::CreateGroupToken { args }.data(),
        }
    }

    pub fn create_collection(
        svm: &mut LiteSVM,
        program_id: Pubkey,
        payer: &Keypair,
        owner: &Keypair,
        group_args: CreateGroupTokenArgs,
    ) -> Pubkey {
        let program_authority =
            Pubkey::find_program_address(&[PROGRAM_AUTHORITY_SEED], &program_id).0;
        let group_mint = Pubkey::find_program_address(
            &[GROUP_MINT_SEED, &group_args.unique_id.to_le_bytes()],
            &program_id,
        )
        .0;

        let accounts = phygital_nfts::accounts::CreateGroupToken {
            payer: payer.pubkey(),
            owner: owner.pubkey(),
            group_mint,
            program_authority,
            token_program: TOKEN_2022_ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None);
        let group_ix = Instruction {
            program_id,
            accounts,
            data: phygital_nfts::instruction::CreateGroupToken { args: group_args }.data(),
        };
        Self::send_instruction(svm, group_ix, &[payer, owner]).expect("create group token");
        group_mint
    }

    pub fn execute_transfer_ix(
        &self,
        recipient: Pubkey,
        sender: Pubkey,
        token_mint: Pubkey,
        group_mint: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::ExecuteTransfer {
                recipient,
                sender,
                token_mint,
                group_mint,
                sender_token_account: get_associated_token_address_with_program_id(
                    &sender,
                    &token_mint,
                    &TOKEN_2022_ID,
                ),
                recipient_token_account: get_associated_token_address_with_program_id(
                    &recipient,
                    &token_mint,
                    &TOKEN_2022_ID,
                ),
                program_authority: self.program_authority(),
                slot_hashes: SLOT_HASHES_SYSVAR_ID,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
                token_program: TOKEN_2022_ID,
                associated_token_program: ASSOCIATED_TOKEN_ID,
                system_program: anchor_lang::solana_program::system_program::ID,
                transfer_hook_program: self.transfer_hook_program_id,
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
        token_mint: Pubkey,
    ) -> Instruction {
        anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
            &payer,
            &owner,
            &token_mint,
            &TOKEN_2022_ID,
        )
    }

    pub fn owner_transfer_checked_ix(
        &self,
        owner: Pubkey,
        token_mint: Pubkey,
        recipient: Pubkey,
    ) -> Instruction {
        let sender_ata =
            get_associated_token_address_with_program_id(&owner, &token_mint, &TOKEN_2022_ID);
        let recipient_ata =
            get_associated_token_address_with_program_id(&recipient, &token_mint, &TOKEN_2022_ID);
        transfer_checked(
            &TOKEN_2022_ID,
            &sender_ata,
            &token_mint,
            &recipient_ata,
            &owner,
            &[],
            1,
            0,
        )
        .expect("transfer_checked ix")
    }

    pub fn mint_nft_with_passkey(&mut self, passkey: &TestPasskey) -> MintedNft {
        let collection_owner = Keypair::new();
        let holder = Keypair::new();
        let token_mint = Keypair::new();

        self.svm
            .airdrop(&collection_owner.pubkey(), 2 * LAMPORTS_PER_SOL)
            .unwrap();
        self.svm
            .airdrop(&holder.pubkey(), 2 * LAMPORTS_PER_SOL)
            .unwrap();

        let group_args = sample_create_group_args();
        let group_mint = Self::create_collection(
            &mut self.svm,
            self.program_id,
            &self.payer,
            &collection_owner,
            group_args,
        );

        self.fund_program_authority(None);

        let mut token_args = sample_create_token_args();
        token_args.secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);

        let token_ix = self.create_token_ix(
            self.payer.pubkey(),
            holder.pubkey(),
            token_mint.pubkey(),
            group_mint,
            token_args,
        );
        Self::send_instruction(
            &mut self.svm,
            token_ix,
            &[&self.payer, &holder, &token_mint],
        )
        .expect("create token");

        MintedNft {
            collection_owner,
            holder,
            token_mint,
            group_mint,
            passkey: passkey.clone(),
        }
    }

    pub fn send_execute_transfer(
        &mut self,
        nft: &MintedNft,
        recipient: &Keypair,
        include_secp_ix: bool,
    ) -> litesvm::types::TransactionResult {
        self.send_execute_transfer_from(
            nft,
            nft.holder.pubkey(),
            recipient,
            include_secp_ix,
            None,
            None,
        )
    }

    pub fn send_execute_transfer_from(
        &mut self,
        nft: &MintedNft,
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

        let (secp_ix, verify_args) = nft.passkey.secp256r1_verify_instruction(
            TOKEN_2022_ID,
            nft.token_mint.pubkey(),
            sender,
            slot_number,
            slot_hash,
        );

        let transfer_ix = self.execute_transfer_ix(
            recipient.pubkey(),
            sender,
            nft.token_mint.pubkey(),
            nft.group_mint,
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

        // Only the recipient signs — sender/holder is intentionally omitted.
        Self::send_instructions(&mut self.svm, &instructions, &[recipient])
    }

    /// Advances clock + SlotHashes so `current_slot_entry` returns the given slot.
    pub fn set_current_slot(&mut self, slot: u64) {
        use solana_slot_hashes::SlotHashes;

        self.svm.warp_to_slot(slot);
        let hash = solana_message::Hash::new_from_array([slot as u8; 32]);
        self.svm.set_sysvar(&SlotHashes::new(&[(slot, hash)]));
    }

    pub fn last_transfer_slot(&self, token_mint: Pubkey) -> u64 {
        use anchor_spl::token_2022::spl_token_2022::extension::{
            BaseStateWithExtensions, StateWithExtensions,
        };
        use anchor_spl::token_2022::spl_token_2022::state::Mint as SplMint;
        use phygital_nfts::utils::LAST_TRANSFER_SLOT_METADATA_KEY;
        use spl_token_metadata_interface::state::TokenMetadata;

        let account = self.svm.get_account(&token_mint).expect("mint account");
        let state = StateWithExtensions::<SplMint>::unpack(&account.data).expect("unpack mint");
        let metadata = state
            .get_variable_len_extension::<TokenMetadata>()
            .expect("token metadata");
        let value = metadata
            .additional_metadata
            .iter()
            .find(|(key, _)| key == LAST_TRANSFER_SLOT_METADATA_KEY)
            .map(|(_, value)| value.as_str())
            .unwrap_or("0");
        value.parse().expect("parse last transfer slot")
    }

    pub fn token_balance(&self, owner: Pubkey, token_mint: Pubkey) -> u64 {
        use anchor_spl::token_2022::spl_token_2022::extension::StateWithExtensions;

        let ata = get_associated_token_address_with_program_id(&owner, &token_mint, &TOKEN_2022_ID);
        let Some(account) = self.svm.get_account(&ata) else {
            return 0;
        };
        let state = StateWithExtensions::<TokenAccountState>::unpack(&account.data)
            .expect("unpack token account");
        state.base.amount
    }

    pub fn create_token_ix(
        &self,
        payer: Pubkey,
        owner: Pubkey,
        token_mint: Pubkey,
        group_mint: Pubkey,
        args: CreateTokenArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::CreateToken {
                payer,
                owner,
                token_mint,
                group_mint,
                program_authority: self.program_authority(),
                owner_token_account: get_associated_token_address_with_program_id(
                    &owner,
                    &token_mint,
                    &TOKEN_2022_ID,
                ),
                token_program: TOKEN_2022_ID,
                associated_token_program: ASSOCIATED_TOKEN_ID,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::CreateToken { args }.data(),
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
        let rent: Rent = self.svm.get_sysvar();
        let ata_rent = rent.minimum_balance(TokenAccountState::LEN);
        ata_rent.checked_mul(10).expect("rent pool target")
    }
}

pub fn sample_create_group_args() -> CreateGroupTokenArgs {
    CreateGroupTokenArgs {
        name: "Test Collection".to_string(),
        symbol: "TCOL".to_string(),
        uri: "https://example.com/collection.json".to_string(),
        max_size: 100,
        unique_id: 1,
    }
}

pub fn sample_create_token_args() -> CreateTokenArgs {
    CreateTokenArgs {
        name: "Test NFT".to_string(),
        symbol: "TNFT".to_string(),
        uri: "https://example.com/nft.json".to_string(),
        secp256r1_pubkey: Secp256r1Pubkey([0x02; 33]),
    }
}
