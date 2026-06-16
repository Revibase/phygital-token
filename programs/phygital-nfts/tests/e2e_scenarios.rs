mod common;

use common::{
    assert_transaction_failed, current_slot_entry, MintedCard, TestContext, TestPasskey,
};
use phygital_nfts::{MintTokenArgs, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn e2e_happy_lifecycle_with_retransfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&card, &first_recipient, true)
        .expect("claim");
    assert_eq!(ctx.last_transfer_slot(card.card_instance), first_slot);

    let (owner, mint, _) = ctx.card_instance_fields(card.card_instance);
    assert_eq!(owner, first_recipient.pubkey());
    assert_eq!(mint, card.mint);

    let card_for_holder = MintedCard {
        passkey: passkey.clone(),
        collection_owner: Keypair::new(),
        holder: Keypair::new(),
        mint: card.mint,
        card_instance: card.card_instance,
        group_mint: card.group_mint,
    };
    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer_from(
        &card_for_holder,
        first_recipient.pubkey(),
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
    )
    .expect("re-transfer");

    assert_eq!(ctx.last_transfer_slot(card.card_instance), second_slot);
    assert_eq!(ctx.token_balance(second_recipient.pubkey(), card.mint), 1);
}

#[test]
fn e2e_mint_funded_rent_liveness() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&passkey_a);
    let recipient = Keypair::new();

    let err = ctx.send_execute_transfer(&card, &recipient, true);
    assert_transaction_failed(err);

    ctx.mint_second_card_same_design(&card, &TestPasskey::generate());
    ctx.send_execute_transfer(&card, &recipient, true)
        .expect("transfer after one rent top-up mint");
    assert_eq!(ctx.token_balance(recipient.pubkey(), card.mint), 1);
}

#[test]
fn e2e_manual_rent_fund_liveness() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&passkey);
    ctx.fund_program_authority(Some(ctx.recipient_ata_rent()));
    let recipient = Keypair::new();

    ctx.send_execute_transfer(&card, &recipient, true)
        .expect("transfer with manual rent fund");
    assert_eq!(ctx.token_balance(recipient.pubkey(), card.mint), 1);
}

#[test]
fn e2e_multi_card_same_design_custody() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let passkey_c = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey_a);
    ctx.mint_second_card_same_design(&card, &passkey_b);
    ctx.mint_second_card_same_design(&card, &passkey_c);

    let recipient_a = Keypair::new();
    let recipient_b = Keypair::new();
    let card_a = MintedCard {
        passkey: passkey_a.clone(),
        collection_owner: Keypair::new(),
        holder: Keypair::new(),
        mint: card.mint,
        card_instance: card.card_instance,
        group_mint: card.group_mint,
    };
    let card_b = MintedCard {
        passkey: passkey_b.clone(),
        collection_owner: Keypair::new(),
        holder: Keypair::new(),
        mint: card.mint,
        card_instance: ctx.card_instance_pda(&Secp256r1Pubkey(passkey_b.compressed_pubkey)),
        group_mint: card.group_mint,
    };

    ctx.send_execute_transfer(&card_a, &recipient_a, true)
        .expect("claim A");
    ctx.send_execute_transfer(&card_b, &recipient_b, true)
        .expect("claim B");

    assert_eq!(ctx.token_balance(ctx.program_authority(), card.mint), 1);
    assert_eq!(ctx.token_balance(recipient_a.pubkey(), card.mint), 1);
    assert_eq!(ctx.token_balance(recipient_b.pubkey(), card.mint), 1);
}

#[test]
fn e2e_card_pda_squatting_blocks_victim() {
    let mut ctx = TestContext::new();
    let victim_passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&TestPasskey::generate());

    let victim_pubkey = Secp256r1Pubkey(victim_passkey.compressed_pubkey);
    let victim_card = ctx.card_instance_pda(&victim_pubkey);
    let args = MintTokenArgs {
        secp256r1_pubkey: victim_pubkey,
    };
    let ix = ctx.mint_token_ix(ctx.payer.pubkey(), victim_card, card.mint, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]).expect("squatter mint");

    let ix2 = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        victim_card,
        card.mint,
        MintTokenArgs {
            secp256r1_pubkey: victim_pubkey,
        },
    );
    TestContext::send_instruction(&mut ctx.svm, ix2, &[&ctx.payer])
        .expect_err("victim blocked");
}
