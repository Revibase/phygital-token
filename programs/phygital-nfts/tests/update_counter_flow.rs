mod common;

use common::{assert_token_program_error, TestContext, TestPasskey};
use phygital_nfts::Secp256r1Pubkey;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn update_counter_advances_from_unset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let payer = Keypair::new();

    ctx.send_update_counter(card.card_instance, &passkey, 5, &payer)
        .expect("first counter sync should succeed");

    assert_eq!(ctx.last_counter(card.card_instance), 5);
}

#[test]
fn update_counter_rejects_stale_or_equal_counter() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let payer = Keypair::new();

    ctx.send_update_counter(card.card_instance, &passkey, 10, &payer)
        .expect("sync to 10");

    // Equal counter is not strictly greater — rejected.
    let err = ctx.send_update_counter(card.card_instance, &passkey, 10, &payer);
    assert_token_program_error(err, "StaleTransferCounter");

    // Lower counter is rejected too.
    let err = ctx.send_update_counter(card.card_instance, &passkey, 3, &payer);
    assert_token_program_error(err, "StaleTransferCounter");

    assert_eq!(ctx.last_counter(card.card_instance), 10);
}

#[test]
fn update_counter_closes_drift_so_stale_tap_cannot_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let payer = Keypair::new();
    let recipient = Keypair::new();

    // Off-chain verifications advanced the physical tag to 50; sync it on-chain.
    ctx.send_update_counter(card.card_instance, &passkey, 50, &payer)
        .expect("sync to 50");
    assert_eq!(ctx.last_counter(card.card_instance), 50);

    // A captured tap with a counter below the synced value can no longer transfer.
    let stale =
        ctx.send_execute_transfer_from(&card, ctx.program_authority(), &recipient, true, Some(40));
    assert_token_program_error(stale, "StaleTransferCounter");
    assert_eq!(ctx.token_balance(recipient.pubkey(), card.mint), 0);

    // A fresh tap above the synced value still works.
    ctx.send_execute_transfer_from(&card, ctx.program_authority(), &recipient, true, Some(51))
        .expect("fresh tap above synced counter transfers");
    assert_eq!(ctx.last_counter(card.card_instance), 51);
}

#[test]
fn update_counter_rejects_pubkey_not_matching_card() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let card_a = ctx.mint_card_with_passkey(&passkey_a);
    ctx.mint_second_card_same_design(&card_a, &passkey_b);
    let payer = Keypair::new();

    // passkey_a signs, but we point at card_b's instance.
    let card_b_instance = ctx.card_instance_pda(&Secp256r1Pubkey(passkey_b.compressed_pubkey));
    let err = ctx.send_update_counter(card_b_instance, &passkey_a, 5, &payer);
    assert_token_program_error(err, "Secp256r1PubkeyMismatch");
}
