mod common;

use anchor_lang::AccountDeserialize;
use common::{current_slot_entry, MintedCard, TestContext, TestPasskey, LAMPORTS_PER_SOL};
use phygital_nfts::state::CardInstance;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn execute_transfer_moves_card_to_recipient_without_sender_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();
    let program_authority = ctx.program_authority();

    assert_eq!(ctx.token_balance(program_authority, card.mint), 1);
    assert_eq!(ctx.token_balance(recipient.pubkey(), card.mint), 0);

    let (transfer_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&card, &recipient, true)
        .expect("execute_transfer should succeed with secp256r1 + recipient signature only");
    assert_eq!(
        ctx.last_transfer_slot(card.card_instance),
        transfer_slot,
        "card instance should record the slot used for the transfer"
    );

    assert_eq!(
        ctx.token_balance(program_authority, card.mint),
        0,
        "custody balance should be zero after transfer"
    );
    assert!(
        !ctx.sender_ata_exists(program_authority, card.mint),
        "custody ata should be closed when balance was 1"
    );
    assert_eq!(
        ctx.token_balance(recipient.pubkey(), card.mint),
        1,
        "recipient should hold the card token"
    );

    let card_account = ctx
        .svm
        .get_account(&card.card_instance)
        .expect("card instance account");
    let instance = CardInstance::try_deserialize(
        &mut card_account.data.as_ref(),
    )
    .expect("deserialize card instance");
    assert_eq!(instance.owner, recipient.pubkey());
}

#[test]
fn execute_transfer_rejects_sender_not_matching_card_owner() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey_a);
    ctx.mint_second_card_same_design(&card, &passkey_b);

    let recipient = Keypair::new();
    let card_for_transfer = MintedCard {
        passkey: passkey_a.clone(),
        ..card
    };

    ctx.send_execute_transfer(&card_for_transfer, &recipient, true)
        .expect("claim first card");

    // program_authority still holds the second card's token, but this instance's owner is `recipient`.
    let wrong_recipient = Keypair::new();
    let err = ctx
        .send_execute_transfer_from(
            &card_for_transfer,
            ctx.program_authority(),
            &wrong_recipient,
            true,
            None,
            None,
        )
        .expect_err("transfer with sender not matching card owner should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("OwnerMismatch") || err_str.contains("6012"),
        "unexpected error: {err:?}"
    );
    assert_eq!(ctx.token_balance(recipient.pubkey(), card_for_transfer.mint), 1);
    assert_eq!(ctx.token_balance(wrong_recipient.pubkey(), card_for_transfer.mint), 0);
}

#[test]
fn execute_transfer_keeps_sender_ata_when_balance_remains() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey_a);
    ctx.mint_second_card_same_design(&card, &passkey_b);

    let program_authority = ctx.program_authority();
    assert_eq!(ctx.token_balance(program_authority, card.mint), 2);

    let recipient = Keypair::new();
    let card_for_transfer = MintedCard {
        passkey: passkey_a.clone(),
        ..card
    };

    ctx.send_execute_transfer(&card_for_transfer, &recipient, true)
        .expect("transfer with remaining balance should succeed");

    assert_eq!(ctx.token_balance(program_authority, card_for_transfer.mint), 1);
    assert!(
        ctx.sender_ata_exists(program_authority, card_for_transfer.mint),
        "custody ata should stay open when balance remains"
    );
    assert_eq!(ctx.token_balance(recipient.pubkey(), card_for_transfer.mint), 1);
}

#[test]
fn execute_transfer_requires_preceding_secp256r1_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();

    let err = ctx
        .send_execute_transfer(&card, &recipient, false)
        .expect_err("execute_transfer without secp256r1 ix should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidSecp256r1Instruction")
            || err_str.contains("6002")
            || err_str.contains("PrivilegeEscalation")
            || err_str.contains("MissingSecp256r1Instruction")
            || err_str.contains("InvalidArgument")
            || err_str.contains("ClientDataHashMismatch"),
        "unexpected error: {err:?}"
    );
    assert_eq!(ctx.token_balance(ctx.program_authority(), card.mint), 1);
}

#[test]
fn direct_owner_transfer_checked_is_blocked_by_transfer_hook() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let holder = &card.holder;

    ctx.send_execute_transfer(&card, holder, true)
        .expect("claim card into holder wallet");

    let recipient = Keypair::new();
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .unwrap();

    let create_ata_ix = ctx.create_recipient_ata_ix(
        recipient.pubkey(),
        recipient.pubkey(),
        card.mint,
    );
    TestContext::send_instruction(&mut ctx.svm, create_ata_ix, &[&recipient])
        .expect("create recipient ata");

    let transfer_ix = ctx.owner_transfer_checked_ix(
        holder.pubkey(),
        card.mint,
        recipient.pubkey(),
    );

    let err = TestContext::send_instruction(&mut ctx.svm, transfer_ix, &[holder])
        .expect_err("owner-signed transfer_checked should not bypass execute_transfer");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidTransferAuthority")
            || err_str.contains("6012")
            || err_str.contains("MissingAccount")
            || err_str.contains("MissingRequiredSignature")
            || err_str.contains("custom program error"),
        "transfer hook should block owner-signed transfer_checked: {err:?}"
    );
    assert_eq!(ctx.token_balance(holder.pubkey(), card.mint), 1);
}

#[test]
fn execute_transfer_rejects_slot_not_greater_than_last_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer(&card, &first_recipient, true)
        .expect("first transfer");

    assert_eq!(ctx.last_transfer_slot(card.card_instance), slot_number);

    let err = ctx
        .send_execute_transfer_from(
            &card,
            first_recipient.pubkey(),
            &second_recipient,
            true,
            Some(slot_number),
            Some(slot_hash),
        )
        .expect_err("reusing the same slot after a successful transfer should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("StaleTransferSlot") || err_str.contains("6013"),
        "expected stale slot error, got: {err:?}"
    );
    assert_eq!(ctx.token_balance(second_recipient.pubkey(), card.mint), 0);
    assert_eq!(ctx.token_balance(first_recipient.pubkey(), card.mint), 1);
}

#[test]
fn execute_transfer_allows_next_transfer_with_higher_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&card, &first_recipient, true)
        .expect("first transfer");

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);
    assert!(second_slot > first_slot);

    ctx.send_execute_transfer_from(
        &card,
        first_recipient.pubkey(),
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
    )
    .expect("second transfer with a higher slot should succeed");

    assert_eq!(ctx.last_transfer_slot(card.card_instance), second_slot);
    assert_eq!(ctx.token_balance(second_recipient.pubkey(), card.mint), 1);
}
