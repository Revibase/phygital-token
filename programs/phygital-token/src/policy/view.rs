//! In-place access to a stored `AccessoryPolicy` for the execute path.
//!
//! Deserializing the whole policy on every execute would cost compute and heap,
//! so [`PolicyView::load`] validates the account and records where its
//! variable-length parts start. Account layout (after the 8-byte discriminator):
//!
//! | Field                 | Encoding                                  |
//! |-----------------------|-------------------------------------------|
//! | `phygital_token`      | 32 bytes at 8                             |
//! | `wallet`              | 32 bytes at 40                            |
//! | `sol_cap`             | `Option<SpendCap>` at 72 (1 + 40 bytes)   |
//! | `mint_caps`           | `u32` count, then 72 bytes per `MintCap`  |
//! | `allowed_origins`     | `u32` count, then `u32` length + bytes each |
//! | `program_permissions` | the rest; matched by [`super::matcher`]   |
//!
//! `SpendCap` and `MintCap` are `repr(C)` `Pod` types whose Borsh encoding is
//! their memory layout (asserted in `state/accessory_policy.rs`), so caps are
//! read and written with `bytemuck` at the recorded offsets.

use anchor_lang::prelude::*;

use super::reader::Reader;
use crate::state::{AccessoryPolicy, MintCap, SpendCap};

const PHYGITAL_TOKEN: usize = 8;
const WALLET: usize = 40;
const SOL_CAP: usize = 72;

/// Where the variable-length parts of a policy account start, so the execute
/// path reads and charges it in place instead of deserializing it.
pub(crate) struct PolicyView {
    sol_cap: Option<usize>,
    mint_caps: usize,
    mint_count: usize,
    origins: usize,
    permissions: usize,
}

impl PolicyView {
    /// Checks `info` is the policy of `phygital_token` and `wallet` its wallet.
    /// Policies are only created at the token's PDA, so the stored keys stand
    /// in for re-deriving both addresses.
    pub(crate) fn load(
        info: &AccountInfo,
        phygital_token: &Pubkey,
        wallet: &Pubkey,
    ) -> Result<Self> {
        require_keys_eq!(*info.owner, crate::ID, ErrorCode::AccountNotInitialized);
        let data = info.try_borrow_data()?;
        require!(
            data.starts_with(AccessoryPolicy::DISCRIMINATOR),
            ErrorCode::AccountDiscriminatorMismatch
        );
        require!(
            data.get(PHYGITAL_TOKEN..WALLET) == Some(phygital_token.as_ref()),
            ErrorCode::ConstraintHasOne
        );
        require!(
            data.get(WALLET..SOL_CAP) == Some(wallet.as_ref()),
            ErrorCode::ConstraintAddress
        );
        let mut r = Reader::new(&data, SOL_CAP);
        let sol_cap = r.option(|r| {
            let at = r.pos;
            r.take(size_of::<SpendCap>()).map(|_| at)
        })?;
        let mint_count = r.u32()? as usize;
        let mint_caps = r.pos;
        r.take(
            mint_count
                .checked_mul(size_of::<MintCap>())
                .ok_or_else(|| error!(ErrorCode::AccountDidNotDeserialize))?,
        )?;
        let origins = r.pos;
        for _ in 0..r.u32()? {
            r.bytes()?;
        }
        Ok(Self {
            sol_cap,
            mint_caps,
            mint_count,
            origins,
            permissions: r.pos,
        })
    }

    pub(crate) fn sol_cap(&self, data: &[u8]) -> Option<SpendCap> {
        self.sol_cap
            .map(|at| bytemuck::pod_read_unaligned(&data[at..at + size_of::<SpendCap>()]))
    }

    pub(crate) fn set_sol_cap(&self, data: &mut [u8], cap: &SpendCap) {
        if let Some(at) = self.sol_cap {
            data[at..at + size_of::<SpendCap>()].copy_from_slice(bytemuck::bytes_of(cap));
        }
    }

    fn mint_cap_range(&self, slot: usize) -> core::ops::Range<usize> {
        let at = self.mint_caps + slot * size_of::<MintCap>();
        at..at + size_of::<MintCap>()
    }

    pub(crate) fn mint_count(&self) -> usize {
        self.mint_count
    }

    pub(crate) fn mint_slot(&self, data: &[u8], mint: &Pubkey) -> Option<usize> {
        (0..self.mint_count).find(|&slot| data[self.mint_cap_range(slot)][..32] == *mint.as_ref())
    }

    pub(crate) fn mint_cap(&self, data: &[u8], slot: usize) -> MintCap {
        bytemuck::pod_read_unaligned(&data[self.mint_cap_range(slot)])
    }

    pub(crate) fn set_mint_cap(&self, data: &mut [u8], slot: usize, cap: &MintCap) {
        data[self.mint_cap_range(slot)].copy_from_slice(bytemuck::bytes_of(cap));
    }

    pub(crate) fn origin_allowed(&self, data: &[u8], origin: &[u8]) -> Result<bool> {
        let mut r = Reader::new(data, self.origins);
        let count = r.u32()?;
        for _ in 0..count {
            if r.bytes()? == origin {
                return Ok(true);
            }
        }
        Ok(count == 0)
    }

    pub(crate) fn permissions<'a>(&self, data: &'a [u8]) -> &'a [u8] {
        &data[self.permissions..]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{
        AccountConstraint, AccountKeyConstraint, DataConstraint, DataPredicate, InstructionRule,
        ProgramAccess, ProgramPermission,
    };
    use proptest::prelude::*;

    fn cap(n: u64) -> SpendCap {
        SpendCap {
            cap: n,
            remaining: n - 1,
            last_reset: 1_700_000_000,
            window_seconds: 3_600,
            max_per_tx: n / 2,
        }
    }

    fn sample() -> AccessoryPolicy {
        AccessoryPolicy {
            phygital_token: Pubkey::new_unique(),
            wallet: Pubkey::new_unique(),
            sol_cap: Some(cap(1_000)),
            mint_caps: vec![
                MintCap {
                    mint: Pubkey::new_unique(),
                    cap: cap(2_000),
                },
                MintCap {
                    mint: Pubkey::new_unique(),
                    cap: cap(3_000),
                },
            ],
            allowed_origins: vec!["https://a.example".into(), "https://b.example:8443".into()],
            program_permissions: vec![
                ProgramPermission {
                    program_id: Pubkey::new_unique(),
                    access: ProgramAccess::AllInstructions,
                },
                ProgramPermission {
                    program_id: Pubkey::new_unique(),
                    access: ProgramAccess::Restricted(vec![InstructionRule {
                        selector: vec![3, 0, 0, 0],
                        data_length: Some(12),
                        account_count: Some(2),
                        accounts: vec![AccountConstraint {
                            index: 0,
                            key: AccountKeyConstraint::Wallet,
                            owner: None,
                            is_signer: Some(true),
                            is_writable: None,
                            data: vec![],
                        }],
                        arguments: vec![DataConstraint {
                            offset: 4,
                            predicate: DataPredicate::BytesEqual(vec![9]),
                        }],
                    }]),
                },
            ],
        }
    }

    fn encode(policy: &AccessoryPolicy) -> Vec<u8> {
        let mut data = Vec::new();
        policy.try_serialize(&mut data).unwrap();
        data
    }

    fn with_view<R>(
        data: &mut [u8],
        policy: &AccessoryPolicy,
        f: impl FnOnce(&PolicyView, &[u8]) -> R,
    ) -> R {
        let key = Pubkey::new_unique();
        let mut lamports = 0;
        let mut copy = data.to_vec();
        let info = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut copy,
            &crate::ID,
            false,
        );
        let view = PolicyView::load(&info, &policy.phygital_token, &policy.wallet).unwrap();
        f(&view, data)
    }

    /// The in-place offsets agree with the derived Borsh encoding.
    #[test]
    fn view_reads_what_borsh_wrote() {
        let policy = sample();
        let mut data = encode(&policy);
        with_view(&mut data, &policy, |view, data| {
            assert_eq!(view.sol_cap(data), policy.sol_cap);
            assert_eq!(view.mint_count(), policy.mint_caps.len());
            for (slot, mint) in policy.mint_caps.iter().enumerate() {
                assert_eq!(view.mint_cap(data, slot), *mint);
                assert_eq!(view.mint_slot(data, &mint.mint), Some(slot));
            }
            assert_eq!(view.mint_slot(data, &Pubkey::new_unique()), None);
            assert!(view
                .origin_allowed(data, b"https://b.example:8443")
                .unwrap());
            assert!(!view.origin_allowed(data, b"https://c.example").unwrap());
            let mut permissions = Vec::new();
            policy
                .program_permissions
                .serialize(&mut permissions)
                .unwrap();
            assert_eq!(view.permissions(data), &permissions[..]);
        });
    }

    /// Writes through the view land on the fields Borsh reads back.
    #[test]
    fn view_writes_what_borsh_reads() {
        let policy = sample();
        let mut data = encode(&policy);
        let key = Pubkey::new_unique();
        let mut lamports = 0;
        let mut copy = data.clone();
        let info = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut copy,
            &crate::ID,
            false,
        );
        let view = PolicyView::load(&info, &policy.phygital_token, &policy.wallet).unwrap();
        let new_sol = cap(7_777);
        let new_mint = MintCap {
            mint: policy.mint_caps[1].mint,
            cap: cap(8_888),
        };
        view.set_sol_cap(&mut data, &new_sol);
        view.set_mint_cap(&mut data, 1, &new_mint);
        let decoded = AccessoryPolicy::try_deserialize(&mut &data[..]).unwrap();
        assert_eq!(decoded.sol_cap, Some(new_sol));
        assert_eq!(decoded.mint_caps[0], policy.mint_caps[0]);
        assert_eq!(decoded.mint_caps[1], new_mint);
        assert_eq!(decoded.allowed_origins, policy.allowed_origins);
        assert_eq!(decoded.program_permissions, policy.program_permissions);
    }

    #[test]
    fn view_rejects_another_tokens_policy() {
        let policy = sample();
        let mut data = encode(&policy);
        let key = Pubkey::new_unique();
        let mut lamports = 0;
        let info = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut data,
            &crate::ID,
            false,
        );
        assert!(PolicyView::load(&info, &Pubkey::new_unique(), &policy.wallet).is_err());
        assert!(PolicyView::load(&info, &policy.phygital_token, &Pubkey::new_unique()).is_err());
    }

    proptest! {
        /// Truncated or corrupted policy bytes fail cleanly instead of panicking.
        #[test]
        fn load_never_panics(cut in 0usize..600, flip in proptest::collection::vec((0usize..600, any::<u8>()), 0..8)) {
            let policy = sample();
            let mut data = encode(&policy);
            for (at, byte) in flip {
                if at >= 72 && at < data.len() { data[at] = byte; }
            }
            data.truncate(cut.min(data.len()));
            let key = Pubkey::new_unique();
            let mut lamports = 0;
            let info = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &crate::ID, false);
            let _ = PolicyView::load(&info, &policy.phygital_token, &policy.wallet);
        }
    }
}
