mod common;

use anchor_lang::prelude::Pubkey;
use common::{TestContext, TestPasskey};
use phygital_token::Secp256r1Pubkey;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn e2e_initialize_and_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();

    // Freshly initialized phygital_token is unowned and records both the unique chip
    // identifier (binding field) and the transfer-authorizing passkey public key
    // (which also seeds the PDA).
    let instance = ctx.phygital_token_account(phygital_token.phygital_token);
    assert_eq!(instance.owner, Pubkey::default());
    assert_eq!(instance.identifier, phygital_token.identifier);
    assert_eq!(
        instance.public_key,
        Secp256r1Pubkey(passkey.compressed_pubkey)
    );
    assert_ne!(
        instance.identifier, instance.public_key,
        "identifier must be distinct from the passkey public key"
    );
    assert_eq!(instance.last_sign_count, 0);
    assert_eq!(
        instance.mint,
        Pubkey::default(),
        "mint is unset until set_mint"
    );

    ctx.send_transfer_ownership(&phygital_token, &recipient, true)
        .expect("transfer_ownership should succeed");

    assert_eq!(
        ctx.last_sign_count(phygital_token.phygital_token),
        1,
        "phygital_token should record the WebAuthn signCount used for the transfer"
    );
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), recipient.pubkey());
}
