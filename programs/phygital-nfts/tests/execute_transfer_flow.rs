mod common;

use common::{current_slot_entry, TestContext, TestPasskey, LAMPORTS_PER_SOL};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn execute_transfer_moves_nft_to_recipient_without_sender_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let nft = ctx.mint_nft_with_passkey(&passkey);
    let recipient = Keypair::new();

    assert_eq!(
        ctx.token_balance(nft.holder.pubkey(), nft.token_mint.pubkey()),
        1
    );
    assert_eq!(
        ctx.token_balance(recipient.pubkey(), nft.token_mint.pubkey()),
        0
    );

    let (transfer_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&nft, &recipient, true)
        .expect("execute_transfer should succeed with secp256r1 + recipient signature only");
    assert_eq!(
        ctx.last_transfer_slot(nft.token_mint.pubkey()),
        transfer_slot,
        "mint metadata should record the slot used for the transfer"
    );

    assert_eq!(
        ctx.token_balance(nft.holder.pubkey(), nft.token_mint.pubkey()),
        0,
        "sender ata should be closed after transfer"
    );
    assert_eq!(
        ctx.token_balance(recipient.pubkey(), nft.token_mint.pubkey()),
        1,
        "recipient should hold the NFT"
    );
}

#[test]
fn execute_transfer_requires_preceding_secp256r1_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let nft = ctx.mint_nft_with_passkey(&passkey);
    let recipient = Keypair::new();

    let err = ctx
        .send_execute_transfer(&nft, &recipient, false)
        .expect_err("execute_transfer without secp256r1 ix should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidSecp256r1Instruction")
            || err_str.contains("6002")
            || err_str.contains("PrivilegeEscalation")
            || err_str.contains("MissingSecp256r1Instruction")
            || err_str.contains("InvalidArgument")
            || err_str.contains("ClientDataHashMismatch")
            || err_str.contains("InvalidSecp256r1Instruction"),
        "unexpected error: {err:?}"
    );
    assert_eq!(
        ctx.token_balance(nft.holder.pubkey(), nft.token_mint.pubkey()),
        1,
        "NFT should remain with sender when verification is missing"
    );
}

#[test]
fn direct_owner_transfer_checked_is_blocked_by_transfer_hook() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let nft = ctx.mint_nft_with_passkey(&passkey);
    let recipient = Keypair::new();

    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .unwrap();

    let create_ata_ix = ctx.create_recipient_ata_ix(
        recipient.pubkey(),
        recipient.pubkey(),
        nft.token_mint.pubkey(),
    );
    TestContext::send_instruction(&mut ctx.svm, create_ata_ix, &[&recipient])
        .expect("create recipient ata");

    let transfer_ix = ctx.owner_transfer_checked_ix(
        nft.holder.pubkey(),
        nft.token_mint.pubkey(),
        recipient.pubkey(),
    );

    let err = TestContext::send_instruction(
        &mut ctx.svm,
        transfer_ix,
        &[&nft.holder],
    )
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
    assert_eq!(
        ctx.token_balance(nft.holder.pubkey(), nft.token_mint.pubkey()),
        1,
        "NFT must stay with owner when bypassing execute_transfer"
    );
}

#[test]
fn execute_transfer_rejects_slot_not_greater_than_last_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let nft = ctx.mint_nft_with_passkey(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer(&nft, &first_recipient, true)
        .expect("first transfer");

    assert_eq!(
        ctx.last_transfer_slot(nft.token_mint.pubkey()),
        slot_number
    );

    let err = ctx
        .send_execute_transfer_from(
            &nft,
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
    assert_eq!(
        ctx.token_balance(second_recipient.pubkey(), nft.token_mint.pubkey()),
        0,
        "NFT must not move when slot replay is rejected"
    );
    assert_eq!(
        ctx.token_balance(first_recipient.pubkey(), nft.token_mint.pubkey()),
        1,
        "NFT should remain with the current holder"
    );
}

#[test]
fn execute_transfer_allows_next_transfer_with_higher_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let nft = ctx.mint_nft_with_passkey(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&nft, &first_recipient, true)
        .expect("first transfer");

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);
    assert!(second_slot > first_slot);

    ctx.send_execute_transfer_from(
        &nft,
        first_recipient.pubkey(),
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
    )
    .expect("second transfer with a higher slot should succeed");

    assert_eq!(
        ctx.last_transfer_slot(nft.token_mint.pubkey()),
        second_slot
    );
    assert_eq!(
        ctx.token_balance(second_recipient.pubkey(), nft.token_mint.pubkey()),
        1
    );
}
