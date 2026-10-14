//! Spend policies and tap payments.

use super::spl::DECIMALS;
use super::*;
use phygital_token::{SpendPolicy, SpendPolicyAction, DELEGATE_SEED};

pub const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";

/// An owned accessory with a funded, delegated token account and a
/// registered merchant, ready to pay.
pub struct PaySetup {
    pub token: MintedPhygitalToken,
    pub owner: Keypair,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub source: Pubkey,
    pub registrar: Keypair,
    pub merchant: Keypair,
    pub payee: Pubkey,
    pub destination: Pubkey,
}

/// What one `pay_with_accessory` call uses; tests override fields.
#[derive(Clone)]
pub struct Payment {
    pub phygital_token: Pubkey,
    pub merchant: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub source: Pubkey,
    pub destination: Pubkey,
    pub reference: Pubkey,
    pub amount: u64,
    pub decimals: u8,
}

impl PaySetup {
    pub fn payment(&self, amount: u64) -> Payment {
        Payment {
            phygital_token: self.token.phygital_token,
            merchant: self.merchant.pubkey(),
            mint: self.mint,
            token_program: self.token_program,
            source: self.source,
            destination: self.destination,
            reference: Pubkey::new_unique(),
            amount,
            decimals: DECIMALS,
        }
    }
}

pub fn daily_limit(mint: Pubkey, limit: u64, max_per_tap: u64) -> SpendPolicyAction {
    SpendPolicyAction::SetDailyLimit {
        mint,
        limit,
        max_per_tap,
    }
}

impl TestContext {
    pub fn delegate_pda(&self, owner: Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[DELEGATE_SEED, owner.as_ref()], &self.program_id).0
    }

    pub fn event_authority_pda(&self) -> Pubkey {
        Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &self.program_id).0
    }

    pub fn advance_clock(&mut self, seconds: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar(&clock);
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

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

    pub fn update_spend_policy_ix(
        &self,
        owner: Pubkey,
        payer: Pubkey,
        phygital_token: Pubkey,
        actions: Vec<SpendPolicyAction>,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::UpdateSpendPolicy {
                owner,
                payer,
                phygital_token,
                spend_policy: self.spend_policy_pda(phygital_token),
                system_program: anchor_lang::solana_program::system_program::ID,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::UpdateSpendPolicy { actions }.data(),
        }
    }

    pub fn send_update_spend_policy(
        &mut self,
        phygital_token: Pubkey,
        owner: &Keypair,
        actions: Vec<SpendPolicyAction>,
    ) -> litesvm::types::TransactionResult {
        let ix =
            self.update_spend_policy_ix(owner.pubkey(), owner.pubkey(), phygital_token, actions);
        Self::send_instruction(&mut self.svm, ix, &[owner])
    }

    pub fn close_spend_policy(
        &mut self,
        phygital_token: Pubkey,
        owner: &Keypair,
    ) -> litesvm::types::TransactionResult {
        let ix = Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::CloseSpendPolicy {
                owner: owner.pubkey(),
                phygital_token,
                spend_policy: self.spend_policy_pda(phygital_token),
            }
            .to_account_metas(None),
            data: phygital_token::instruction::CloseSpendPolicy {}.data(),
        };
        Self::send_instruction(&mut self.svm, ix, &[owner])
    }

    pub fn spend_policy(&self, phygital_token: Pubkey) -> Option<SpendPolicy> {
        self.svm
            .get_account(&self.spend_policy_pda(phygital_token))
            .filter(|account| account.owner == self.program_id)
            .map(|account| {
                SpendPolicy::try_deserialize(&mut account.data.as_ref()).expect("spend policy")
            })
    }

    pub fn lamports(&self, key: Pubkey) -> u64 {
        self.svm.get_account(&key).map_or(0, |a| a.lamports)
    }

    /// An owned Bearer accessory paying in a fresh mint of `token_program`:
    /// 1,000 tokens in the owner's account, an allowance of 500 for the owner's
    /// delegate, a daily limit of 100 and a registered merchant.
    pub fn pay_setup(&mut self, token_program: Pubkey) -> PaySetup {
        let (token, owner) = self.owned_token(PhygitalTokenType::Bearer);
        let mint = self.create_mint(token_program);
        self.pay_setup_for(token, owner, mint)
    }

    pub fn pay_setup_for(
        &mut self,
        token: MintedPhygitalToken,
        owner: Keypair,
        mint: Pubkey,
    ) -> PaySetup {
        let token_program = self.svm.get_account(&mint).expect("mint").owner;
        let source = self.create_token_account(owner.pubkey(), mint);
        self.mint_tokens(mint, source, 1_000);
        let delegate = self.delegate_pda(owner.pubkey());
        self.approve(source, mint, delegate, &owner, 500)
            .expect("approve");
        self.send_update_spend_policy(
            token.phygital_token,
            &owner,
            vec![daily_limit(mint, 100, 0)],
        )
        .expect("update spend policy");

        let registrar = self.install_registrar();
        let merchant = Keypair::new();
        let payee = Pubkey::new_unique();
        self.register_merchant(&registrar, &merchant, vec![payee])
            .expect("register merchant");
        let destination = self.create_token_account(payee, mint);
        PaySetup {
            token,
            owner,
            mint,
            token_program,
            source,
            registrar,
            merchant,
            payee,
            destination,
        }
    }

    pub fn pay_ix(
        &self,
        payment: &Payment,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Instruction {
        let owner = self.owner_or(payment.phygital_token, Pubkey::default());
        Instruction {
            program_id: self.program_id,
            accounts: phygital_token::accounts::PayWithAccessory {
                phygital_token: payment.phygital_token,
                spend_policy: self.spend_policy_pda(payment.phygital_token),
                delegate: self.delegate_pda(owner),
                merchant: payment.merchant,
                merchant_record: self.merchant_pda(payment.merchant),
                source: payment.source,
                mint: payment.mint,
                destination: payment.destination,
                reference: payment.reference,
                token_program: payment.token_program,
                slot_hashes: SLOT_HASHES_SYSVAR_ID,
                instructions_sysvar: INSTRUCTIONS_SYSVAR_ID,
                event_authority: self.event_authority_pda(),
                program: self.program_id,
            }
            .to_account_metas(None),
            data: phygital_token::instruction::PayWithAccessory {
                secp256r1_verify_args,
                slot_number,
                amount: payment.amount,
                decimals: payment.decimals,
            }
            .data(),
        }
    }

    /// The precompile instruction and `pay_with_accessory` for a tap by
    /// `passkey` over `signed` (the challenge it signs), submitting `payment`.
    pub fn pay_instructions(
        &self,
        passkey: &TestPasskey,
        signed: &Payment,
        payment: &Payment,
    ) -> Vec<Instruction> {
        let (slot_number, slot_hash) = current_slot_entry(&self.svm);
        let challenge = phygital_token::build_pay_challenge(
            &slot_hash,
            &signed.merchant,
            &signed.mint,
            &signed.destination,
            signed.amount,
            &signed.reference,
        );
        let sign_count = self.next_sign_count(payment.phygital_token);
        let (secp_ix, args) = passkey.secp256r1_instruction_for_challenge(challenge, sign_count);
        vec![secp_ix, self.pay_ix(payment, args, slot_number)]
    }

    /// Taps `setup`'s accessory to pay `payment`, signed by its merchant.
    pub fn pay(
        &mut self,
        setup: &PaySetup,
        payment: &Payment,
    ) -> litesvm::types::TransactionResult {
        let instructions = self.pay_instructions(&setup.token.passkey, payment, payment);
        let merchant = setup.merchant.insecure_clone();
        self.svm.airdrop(&merchant.pubkey(), LAMPORTS_PER_SOL).ok();
        Self::send_instructions(&mut self.svm, &instructions, &[&merchant])
    }
}
