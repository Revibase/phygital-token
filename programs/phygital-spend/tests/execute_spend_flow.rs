mod common;

use anchor_lang::prelude::*;
use common::{current_slot_entry, TestContext, SPEND_DELEGATE_AMOUNT, Signer};
use phygital_spend::SPEND_MESSAGE_TAG;
use solana_keypair::Keypair;

#[test]
fn spend_verify_message_prefixes_domain_tag() {
    let recipient = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let amount = 42u64;

    let message = phygital_spend::build_spend_verify_message(&recipient, &mint, amount);

    assert!(message.starts_with(SPEND_MESSAGE_TAG));
    assert_eq!(message.len(), SPEND_MESSAGE_TAG.len() + 32 + 32 + 8);

    let tag_end = SPEND_MESSAGE_TAG.len();
    assert_eq!(&message[tag_end..tag_end + 32], recipient.as_ref());
    assert_eq!(&message[tag_end + 32..tag_end + 64], mint.as_ref());
    assert_eq!(
        u64::from_le_bytes(message[tag_end + 64..].try_into().unwrap()),
        amount
    );
}

#[test]
fn execute_spend_transfers_delegated_tokens() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient = Keypair::new();
    let spend_amount = 3u64;

    ctx.send_execute_spend(&fixture, &recipient, spend_amount, true)
        .expect("execute_spend should succeed");

    assert_eq!(
        ctx.token_balance(fixture.holder.pubkey(), fixture.spend_mint.mint),
        SPEND_DELEGATE_AMOUNT - spend_amount
    );
    assert_eq!(
        ctx.token_balance(recipient.pubkey(), fixture.spend_mint.mint),
        spend_amount
    );
}

#[test]
fn execute_spend_records_verify_slot_on_asset() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient = Keypair::new();
    let (slot_number, _) = current_slot_entry(&ctx.svm);

    ctx.send_execute_spend(&fixture, &recipient, 1, true)
        .expect("execute_spend should succeed");

    assert_eq!(ctx.last_transfer_slot(fixture.asset.asset), slot_number);
}

#[test]
fn execute_spend_allows_multiple_spends_up_to_allowance() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient_a = Keypair::new();
    let recipient_b = Keypair::new();

    ctx.send_execute_spend(&fixture, &recipient_a, 4, true)
        .expect("first spend");
    ctx.send_execute_spend(&fixture, &recipient_b, 6, true)
        .expect("second spend");

    assert_eq!(
        ctx.token_balance(fixture.holder.pubkey(), fixture.spend_mint.mint),
        0
    );
    assert_eq!(ctx.token_balance(recipient_a.pubkey(), fixture.spend_mint.mint), 4);
    assert_eq!(ctx.token_balance(recipient_b.pubkey(), fixture.spend_mint.mint), 6);
}
