use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use phygital_nfts::constants::PROGRAM_AUTHORITY_SEED;
use phygital_nfts_hook::accounts::ExecuteTransferHook;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn deploy_hook(svm: &mut LiteSVM) {
    let program_id = phygital_nfts_hook::ID;
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../../target/deploy/phygital_nfts_hook.so"),
        manifest_dir.join("../../target/sbpf-solana-solana/release/phygital_nfts_hook.so"),
    ];
    let bytes = candidates
        .iter()
        .find_map(|path| std::fs::read(path).ok())
        .expect("phygital_nfts_hook artifact not found — run anchor build");
    svm.add_program(program_id, &bytes).expect("deploy hook");
}

fn hook_ix(authority: Pubkey) -> Instruction {
    let program_id = phygital_nfts_hook::ID;
    let source = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey();
    let destination = Keypair::new().pubkey();
    let accounts = ExecuteTransferHook {
        source_token_account: source,
        mint,
        destination_token_account: destination,
        authority,
    }
    .to_account_metas(None);
    Instruction {
        program_id,
        accounts,
        data: phygital_nfts_hook::instruction::ExecuteTransferHook { amount: 1 }.data(),
    }
}

fn send_ix(
    svm: &mut LiteSVM,
    ix: Instruction,
    payer: &Keypair,
) -> litesvm::types::TransactionResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).expect("build tx");
    let result = svm.send_transaction(tx);
    svm.expire_blockhash();
    result
}

#[test]
fn hook_accepts_program_authority_pda() {
    let mut svm = LiteSVM::new();
    deploy_hook(&mut svm);
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let (program_authority, _) =
        Pubkey::find_program_address(&[PROGRAM_AUTHORITY_SEED], &phygital_nfts::ID);
    send_ix(&mut svm, hook_ix(program_authority), &payer).expect("hook accepts program authority");
}

#[test]
fn hook_rejects_random_authority() {
    let mut svm = LiteSVM::new();
    deploy_hook(&mut svm);
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let random = Keypair::new().pubkey();
    let err = send_ix(&mut svm, hook_ix(random), &payer).expect_err("random authority");
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidTransferAuthority") || err_str.contains("6021"),
        "unexpected error: {err:?}"
    );
}

#[test]
fn hook_rejects_recipient_as_authority() {
    let mut svm = LiteSVM::new();
    deploy_hook(&mut svm);
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let recipient = Keypair::new().pubkey();
    let err = send_ix(&mut svm, hook_ix(recipient), &payer).expect_err("recipient authority");
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidTransferAuthority") || err_str.contains("6021"),
        "unexpected error: {err:?}"
    );
}
