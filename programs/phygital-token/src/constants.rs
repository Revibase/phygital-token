//! PDA seeds.

/// `PhygitalToken`: `[PHYGITAL_TOKEN_SEED, x(passkey public key)]`.
pub const PHYGITAL_TOKEN_SEED: &[u8] = b"token";
/// `AdminConfig` (singleton): `[ADMIN_CONFIG_SEED]`.
pub const ADMIN_CONFIG_SEED: &[u8] = b"admin";
