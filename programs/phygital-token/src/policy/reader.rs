//! A bounds-checked cursor over Borsh bytes, used to read the stored policy
//! without deserializing it. Every read fails with `AccountDidNotDeserialize`
//! instead of panicking when the data runs out.

use anchor_lang::prelude::*;

/// Reads the stored policy bytes in place.
pub(crate) struct Reader<'a> {
    data: &'a [u8],
    pub(crate) pos: usize,
}

impl<'a> Reader<'a> {
    pub(crate) fn new(data: &'a [u8], pos: usize) -> Self {
        Self { data, pos }
    }

    pub(crate) fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let bytes = self
            .pos
            .checked_add(len)
            .and_then(|end| self.data.get(self.pos..end))
            .ok_or_else(|| error!(ErrorCode::AccountDidNotDeserialize))?;
        self.pos += len;
        Ok(bytes)
    }

    pub(crate) fn array<const N: usize>(&mut self) -> Result<[u8; N]> {
        <[u8; N]>::try_from(self.take(N)?).map_err(|_| error!(ErrorCode::AccountDidNotDeserialize))
    }

    pub(crate) fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    pub(crate) fn u32(&mut self) -> Result<u32> {
        self.array().map(u32::from_le_bytes)
    }

    pub(crate) fn bytes(&mut self) -> Result<&'a [u8]> {
        let len = self.u32()? as usize;
        self.take(len)
    }

    pub(crate) fn option<T>(
        &mut self,
        read: impl FnOnce(&mut Self) -> Result<T>,
    ) -> Result<Option<T>> {
        match self.u8()? {
            0 => Ok(None),
            1 => read(self).map(Some),
            _ => err!(ErrorCode::AccountDidNotDeserialize),
        }
    }
}
