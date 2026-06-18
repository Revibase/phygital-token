use anchor_lang::prelude::*;

#[account]
pub struct DomainConfig {
    pub authority: Pubkey,
    pub rp_id_hash: [u8; 32],
    pub bump: u8,
    pub rp_id: String,
    pub origins: Vec<String>,
}

impl DomainConfig {
    pub fn origins_serialized_len(origins: &[String]) -> usize {
        origins.iter().map(|origin| origin.len() + 4).sum()
    }

    pub fn size(rp_id_len: usize, origins_serialized_len: usize) -> usize {
        8 + 32 + 32 + 1 + 4 + rp_id_len + 4 + origins_serialized_len
    }
}
