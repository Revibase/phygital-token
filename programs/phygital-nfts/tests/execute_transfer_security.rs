mod common;

use anchor_lang::solana_program::system_instruction;
use common::{
    assert_token_program_error, assert_transaction_failed, MintedCard, TestContext, TestPasskey,
    LAMPORTS_PER_SOL,
};
use phygital_nfts::Secp256r1Pubkey;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn execute_transfer_rejects_wrong_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();

    let bad_sig = [0u8; 64];
    let (secp_ix, verify_args) =
        passkey.secp256r1_verify_instruction_with(1, [0u8; 8], Some(bad_sig));
    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        card.card_instance,
        card.mint,
        verify_args,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_transaction_failed(err);
}

#[test]
fn execute_transfer_rejects_passkey_for_different_card() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let card_a = ctx.mint_card_with_passkey(&passkey_a);
    ctx.mint_second_card_same_design(&card_a, &passkey_b);
    let recipient = Keypair::new();

    // passkey_a signs, but the transfer targets card_b's instance — the extracted
    // pubkey will not derive the provided card_instance PDA.
    let card_b_instance = ctx.card_instance_pda(&Secp256r1Pubkey(passkey_b.compressed_pubkey));
    let (secp_ix, verify_args) = passkey_a.secp256r1_verify_instruction(1, [0u8; 8]);
    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        card_b_instance,
        card_a.mint,
        verify_args,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "Secp256r1PubkeyMismatch");
}

#[test]
fn execute_transfer_rejects_secp_not_preceding() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();

    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(1, [0u8; 8]);
    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        card.card_instance,
        card.mint,
        verify_args,
    );
    let noop = system_instruction::transfer(&recipient.pubkey(), &recipient.pubkey(), 0);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err = ctx
        .send_execute_transfer_with_instructions(vec![secp_ix, noop, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "InvalidSecp256r1Instruction");
}

#[test]
fn execute_transfer_rejects_wrong_transfer_hook_program() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();

    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(1, [0u8; 8]);
    let wrong_hook = Keypair::new().pubkey();
    let transfer_ix = ctx.execute_transfer_ix_with_hook(
        recipient.pubkey(),
        ctx.program_authority(),
        card.card_instance,
        card.mint,
        verify_args,
        wrong_hook,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    let err_str = format!("{:?}", err.expect_err("wrong hook"));
    assert!(
        err_str.contains("InvalidTransferHookProgram")
            || err_str.contains("ConstraintAddress")
            || err_str.contains("6018")
            || err_str.contains("2012"),
        "unexpected error: {err_str}"
    );
}

#[test]
fn execute_transfer_fails_with_single_mint_and_no_rent_fund() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&passkey);
    let recipient = Keypair::new();

    assert_eq!(ctx.program_authority_lamports(), 0);
    let err = ctx.send_execute_transfer(&card, &recipient, true);
    assert_transaction_failed(err);
    assert_eq!(ctx.token_balance(ctx.program_authority(), card.mint), 1);
}

#[test]
fn execute_transfer_succeeds_after_mint_funded_rent() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&passkey_a);
    ctx.mint_second_card_same_design(&card, &TestPasskey::generate());
    let recipient = Keypair::new();

    assert!(ctx.program_authority_lamports() >= ctx.recipient_ata_rent());
    ctx.send_execute_transfer(&card, &recipient, true)
        .expect("transfer after mint-funded rent top-ups");
    assert_eq!(ctx.token_balance(recipient.pubkey(), card.mint), 1);
}

#[test]
fn execute_transfer_succeeds_after_manual_rent_fund() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey_without_fund(&passkey);
    ctx.fund_program_authority(Some(ctx.recipient_ata_rent()));
    let recipient = Keypair::new();

    ctx.send_execute_transfer(&card, &recipient, true)
        .expect("transfer after manual fund");
    assert_eq!(ctx.token_balance(recipient.pubkey(), card.mint), 1);
}

#[test]
fn execute_transfer_sets_recipient_close_authority_to_program_authority() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let recipient = Keypair::new();

    ctx.send_execute_transfer(&card, &recipient, true)
        .expect("transfer");

    assert_eq!(
        ctx.recipient_close_authority(recipient.pubkey(), card.mint),
        Some(ctx.program_authority())
    );
}

#[test]
fn execute_transfer_holder_chain_to_second_recipient() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey);
    let holder = &card.holder;
    let second_recipient = Keypair::new();

    ctx.send_execute_transfer(&card, holder, true)
        .expect("claim to holder");

    let card_for_holder = MintedCard {
        passkey: passkey.clone(),
        collection_owner: Keypair::new(),
        holder: Keypair::new(),
        mint: card.mint,
        card_instance: card.card_instance,
        group_mint: card.group_mint,
    };
    // Auto-selects the next tap counter (2), satisfying monotonicity.
    ctx.send_execute_transfer_from(
        &card_for_holder,
        holder.pubkey(),
        &second_recipient,
        true,
        None,
    )
    .expect("holder re-transfer");

    assert_eq!(ctx.token_balance(second_recipient.pubkey(), card.mint), 1);
    let (owner, _, _) = ctx.card_instance_fields(card.card_instance);
    assert_eq!(owner, second_recipient.pubkey());
}

#[test]
fn execute_transfer_rejects_passkey_for_unclaimed_card_b() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let card = ctx.mint_card_with_passkey(&passkey_a);
    let card_b_instance = ctx.mint_second_card_same_design(&card, &passkey_b);
    let recipient = Keypair::new();

    ctx.send_execute_transfer(&card, &recipient, true)
        .expect("claim card A");

    let card_b = MintedCard {
        passkey: passkey_b.clone(),
        collection_owner: Keypair::new(),
        holder: Keypair::new(),
        mint: card.mint,
        card_instance: card_b_instance,
        group_mint: card.group_mint,
    };
    let err =
        ctx.send_execute_transfer_from(&card_b, recipient.pubkey(), &Keypair::new(), true, None);
    assert_token_program_error(err, "OwnerMismatch");
}
