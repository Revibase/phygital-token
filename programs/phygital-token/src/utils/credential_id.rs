use anchor_lang::prelude::*;

pub const CREDENTIAL_ID_SERIALIZED_SIZE: usize = 64;

#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Eq, PartialEq, Hash, Debug, Clone, Copy,
)]
pub struct CredentialId(pub [u8; CREDENTIAL_ID_SERIALIZED_SIZE]);

impl CredentialId {
    pub fn to_bytes(self) -> [u8; CREDENTIAL_ID_SERIALIZED_SIZE] {
        self.0
    }
}

impl Default for CredentialId {
    fn default() -> Self {
        CredentialId([0u8; CREDENTIAL_ID_SERIALIZED_SIZE])
    }
}

impl AsRef<[u8]> for CredentialId {
    fn as_ref(&self) -> &[u8] {
        (&self.0).as_ref()
    }
}