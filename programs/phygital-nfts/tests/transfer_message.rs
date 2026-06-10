mod common;

use common::{sample_transfer_terms, TestContext};
use phygital_nfts::utils::{build_transfer_message_hash, TransferTerms};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn transfer_message_hash_changes_when_price_changes() {
    let mint = Keypair::new().pubkey();
    let sender = Keypair::new().pubkey();
    let recipient = Keypair::new().pubkey();

    let free_terms = sample_transfer_terms();
    let paid_terms = TransferTerms {
        price: 1_000,
        ..free_terms
    };

    let free_hash = build_transfer_message_hash(&mint, &sender, &recipient, &free_terms);
    let paid_hash = build_transfer_message_hash(&mint, &sender, &recipient, &paid_terms);

    assert_ne!(free_hash, paid_hash);
}

#[test]
fn execute_transfer_rejects_signature_signed_at_old_price() {
    let mut ctx = TestContext::new();
    let passkey = common::TestPasskey::generate();
    let nft = ctx.mint_nft_with_passkey(&passkey);
    let recipient = Keypair::new();
    let payment_mint = anchor_lang::prelude::Pubkey::new_from_array([0xAB; 32]);

    let config_ix = ctx.set_transfer_config_ix(
        ctx.payer.pubkey(),
        nft.holder.pubkey(),
        nft.token_mint.pubkey(),
        phygital_nfts::SetTransferConfigArgs {
            price: 1_000,
            payment_token_mint: Some(payment_mint),
            payment_token_program: Some(anchor_spl::token_2022::ID),
            allowed_recipient: None,
        },
    );
    common::TestContext::send_instruction(
        &mut ctx.svm,
        config_ix,
        &[&ctx.payer, &nft.holder],
    )
    .expect("set transfer config");

    let (slot_number, slot_hash) = common::current_slot_entry(&ctx.svm);
    let stale_terms = sample_transfer_terms();

    let err = ctx
        .send_execute_transfer_from(
            &nft,
            nft.holder.pubkey(),
            &recipient,
            true,
            Some(slot_number),
            Some(slot_hash),
            Some(stale_terms),
        )
        .expect_err("signature with stale transfer terms should fail after price update");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("ClientDataHashMismatch") || err_str.contains("6019"),
        "expected challenge mismatch after terms change, got: {err:?}"
    );
}
