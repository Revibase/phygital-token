mod secp256r1;

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
use phygital_nfts::constants::{PROGRAM_AUTHORITY_SEED, SEED_DOMAIN_CONFIG};
use phygital_nfts::{
    CreateDomainConfigArgs, CreateGroupTokenArgs, CreateTokenArgs, EditDomainConfigArgs,
    Secp256r1Pubkey, Secp256r1VerifyArgs, SetTransferConfigArgs,
};
use phygital_nfts::utils::TransferTerms;
use sha2::{Digest, Sha256};
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
    pub group_mint: Keypair,
    pub domain_config: Pubkey,
    pub domain_authority: Pubkey,
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

    pub fn domain_config_pda(&self, rp_id: &str) -> Pubkey {
        let hash: [u8; 32] = Sha256::digest(rp_id.as_bytes()).into();
        Pubkey::find_program_address(&[SEED_DOMAIN_CONFIG, hash.as_ref()], &self.program_id).0
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

    pub fn create_domain_config_ix(
        &self,
        payer: Pubkey,
        authority: Pubkey,
        args: CreateDomainConfigArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::CreateDomainConfig {
                payer,
                authority,
                domain_config: self.domain_config_pda(&args.rp_id),
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::CreateDomainConfig { args }.data(),
        }
    }

    pub fn create_group_token_ix(
        &self,
        payer: Pubkey,
        owner: Pubkey,
        group_mint: Pubkey,
        domain_config: Pubkey,
        args: CreateGroupTokenArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::CreateGroupToken {
                payer,
                owner,
                group_mint,
                domain_config,
                program_authority: self.program_authority(),
                token_program: TOKEN_2022_ID,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::CreateGroupToken { args }.data(),
        }
    }

    pub fn create_collection(
        svm: &mut LiteSVM,
        program_id: Pubkey,
        payer: &Keypair,
        owner: &Keypair,
        group_mint: &Keypair,
        group_args: CreateGroupTokenArgs,
        domain_args: CreateDomainConfigArgs,
    ) {
        let rp_id = domain_args.rp_id.clone();
        let domain_config = {
            let hash: [u8; 32] = Sha256::digest(rp_id.as_bytes()).into();
            Pubkey::find_program_address(&[SEED_DOMAIN_CONFIG, hash.as_ref()], &program_id).0
        };
        let program_authority =
            Pubkey::find_program_address(&[PROGRAM_AUTHORITY_SEED], &program_id).0;

        let domain_ix = Instruction {
            program_id,
            accounts: phygital_nfts::accounts::CreateDomainConfig {
                payer: payer.pubkey(),
                authority: owner.pubkey(),
                domain_config,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::CreateDomainConfig { args: domain_args }.data(),
        };
        Self::send_instruction(svm, domain_ix, &[payer, owner]).expect("create domain config");

        let group_ix = Instruction {
            program_id,
            accounts: phygital_nfts::accounts::CreateGroupToken {
                payer: payer.pubkey(),
                owner: owner.pubkey(),
                group_mint: group_mint.pubkey(),
                domain_config,
                program_authority,
                token_program: TOKEN_2022_ID,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::CreateGroupToken { args: group_args }.data(),
        };
        Self::send_instruction(svm, group_ix, &[payer, owner, group_mint])
            .expect("create group token");
    }

    pub fn edit_domain_config_ix(
        &self,
        authority: Pubkey,
        rp_id: &str,
        args: EditDomainConfigArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::EditDomainConfig {
                domain_config: self.domain_config_pda(rp_id),
                authority,
                new_authority: None
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::EditDomainConfig { args }.data(),
        }
    }

    pub fn set_transfer_config_ix(
        &self,
        payer: Pubkey,
        owner: Pubkey,
        token_mint: Pubkey,
        args: SetTransferConfigArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::SetTransferConfig {
                payer,
                owner,
                token_mint,
                owner_token_account: get_associated_token_address_with_program_id(
                    &owner,
                    &token_mint,
                    &TOKEN_2022_ID,
                ),
                program_authority: self.program_authority(),
                token_program: TOKEN_2022_ID,
                associated_token_program: ASSOCIATED_TOKEN_ID,
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_nfts::instruction::SetTransferConfig { args }.data(),
        }
    }

    pub fn execute_transfer_ix(
        &self,
        recipient: Pubkey,
        sender: Pubkey,
        token_mint: Pubkey,
        group_mint: Pubkey,
        group_owner: Pubkey,
        domain_config: Pubkey,
        domain_authority: Pubkey,
        secp256r1_verify_args: Secp256r1VerifyArgs,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_nfts::accounts::ExecuteTransfer {
                recipient,
                sender,
                token_mint,
                group_mint,
                domain_config,
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
                group_owner,
                domain_authority,
                program_authority: self.program_authority(),
                recipient_payment_token_account: None,
                sender_payment_token_account: None,
                group_owner_payment_token_account: None,
                domain_authority_payment_token_account: None,
                payment_token_mint: None,
                payment_token_program: TOKEN_2022_ID,
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
        let group_mint = Keypair::new();
        let token_mint = Keypair::new();

        self.svm
            .airdrop(&collection_owner.pubkey(), 2 * LAMPORTS_PER_SOL)
            .unwrap();
        self.svm
            .airdrop(&holder.pubkey(), 2 * LAMPORTS_PER_SOL)
            .unwrap();

        Self::create_collection(
            &mut self.svm,
            self.program_id,
            &self.payer,
            &collection_owner,
            &group_mint,
            sample_create_group_args(),
            sample_create_domain_config_args(),
        );

        self.fund_program_authority(None);

        let mut token_args = sample_create_token_args();
        token_args.secp256r1_pubkey = Secp256r1Pubkey(passkey.compressed_pubkey);

        let token_ix = self.create_token_ix(
            self.payer.pubkey(),
            holder.pubkey(),
            token_mint.pubkey(),
            group_mint.pubkey(),
            token_args,
        );
        Self::send_instruction(
            &mut self.svm,
            token_ix,
            &[&self.payer, &holder, &token_mint],
        )
        .expect("create token");

        let domain_authority = collection_owner.pubkey();
        MintedNft {
            collection_owner,
            holder,
            token_mint,
            group_mint,
            domain_config: self.domain_config_pda(TEST_RP_ID),
            domain_authority,
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
        transfer_terms: Option<TransferTerms>,
    ) -> litesvm::types::TransactionResult {
        let (slot_number, slot_hash) = match (slot_number, slot_hash) {
            (Some(slot), Some(hash)) => (slot, hash),
            _ => current_slot_entry(&self.svm),
        };

        let transfer_terms = transfer_terms.unwrap_or_else(sample_transfer_terms);

        let (secp_ix, verify_args) = nft.passkey.secp256r1_verify_instruction(
            TOKEN_2022_ID,
            nft.token_mint.pubkey(),
            sender,
            slot_number,
            slot_hash,
            transfer_terms,
        );

        let transfer_ix = self.execute_transfer_ix(
            recipient.pubkey(),
            sender,
            nft.token_mint.pubkey(),
            nft.group_mint.pubkey(),
            nft.collection_owner.pubkey(),
            nft.domain_config,
            nft.domain_authority,
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

pub fn sample_transfer_terms() -> TransferTerms {
    TransferTerms {
        price: 0,
        payment_token_mint: Pubkey::default(),
        allowed_recipient: Pubkey::default(),
    }
}

pub fn sample_create_domain_config_args() -> CreateDomainConfigArgs {
    let rp_id_hash: [u8; 32] = Sha256::digest(TEST_RP_ID.as_bytes()).into();
    CreateDomainConfigArgs {
        rp_id: TEST_RP_ID.to_string(),
        rp_id_hash,
        origins: vec![TEST_ORIGIN.to_string()],
        royalty_bps: 0,
    }
}

pub fn sample_create_group_args() -> CreateGroupTokenArgs {
    CreateGroupTokenArgs {
        name: "Test Collection".to_string(),
        symbol: "TCOL".to_string(),
        uri: "https://example.com/collection.json".to_string(),
        royalty_bps: Some(500),
        max_size: 100,
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
