use anchor_lang::prelude::*;
use std::str::from_utf8;

use crate::error::TokenProgramError;

pub const MAX_ORIGINS_LEN: usize = 515;
pub const MAX_RP_ID_LEN: usize = u8::MAX as usize;

#[account]
pub struct DomainConfig {
    pub authority: Pubkey,
    pub royalty_bps: u16,
    pub rp_id_hash: [u8; 32],
    pub bump: u8,
    pub rp_id_length: u8,
    pub num_origins: u8,
    pub rp_id: [u8; MAX_RP_ID_LEN],
    pub origins: [u8; MAX_ORIGINS_LEN],
}

impl DomainConfig {
    pub fn size() -> usize {
        8 + 32 + 2 + 32 + 1 + 1 + 1 + MAX_RP_ID_LEN + MAX_ORIGINS_LEN
    }

    pub fn write_rp_id(&mut self, rp_id: impl AsRef<str>) -> Result<()> {
        let rp_id = rp_id.as_ref().as_bytes();

        require!(
            rp_id.len() <= MAX_RP_ID_LEN,
            TokenProgramError::MaxLengthExceeded
        );

        self.rp_id_length = rp_id
            .len()
            .try_into()
            .map_err(|_| error!(TokenProgramError::MaxLengthExceeded))?;
        self.rp_id.fill(0);
        self.rp_id[..rp_id.len()].copy_from_slice(rp_id);
        Ok(())
    }

    pub fn write_origins(&mut self, origins: &[impl AsRef<str>]) -> Result<()> {
        let mut cursor = 0;
        let mut count = 0;

        for origin in origins {
            let origin = origin.as_ref();
            if origin.is_empty() {
                continue;
            }
            let origin_bytes = origin.as_bytes();
            let origin_len = origin_bytes.len();

            let entry_size = 2 + origin_len;
            if cursor + entry_size > MAX_ORIGINS_LEN {
                return err!(TokenProgramError::MaxLengthExceeded);
            }

            let len_bytes = (origin_len as u16).to_le_bytes();
            self.origins[cursor] = len_bytes[0];
            self.origins[cursor + 1] = len_bytes[1];
            cursor += 2;

            self.origins[cursor..cursor + origin_len].copy_from_slice(origin_bytes);
            cursor += origin_len;

            count += 1;
        }

        for i in cursor..MAX_ORIGINS_LEN {
            self.origins[i] = 0;
        }

        self.num_origins = count;

        Ok(())
    }

    pub fn parse_origins(&self) -> Result<Vec<String>> {
        let mut origins = Vec::with_capacity(self.num_origins as usize);
        let mut cursor = 0;

        for _ in 0..self.num_origins {
            if cursor + 2 > self.origins.len() {
                return err!(TokenProgramError::MaxLengthExceeded);
            }

            let len_bytes = [self.origins[cursor], self.origins[cursor + 1]];
            let str_len = u16::from_le_bytes(len_bytes) as usize;
            cursor += 2;

            if cursor + str_len > self.origins.len() {
                return err!(TokenProgramError::MaxLengthExceeded);
            }

            let str_bytes = &self.origins[cursor..cursor + str_len];
            match from_utf8(str_bytes) {
                Ok(s) => origins.push(s.to_string()),
                Err(_) => return err!(TokenProgramError::MaxLengthExceeded),
            }

            cursor += str_len;
        }

        Ok(origins)
    }
}
