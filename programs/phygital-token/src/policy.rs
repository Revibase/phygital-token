use anchor_lang::prelude::*;

use crate::constants::is_wsol_mint;
use crate::error::PhygitalError;
use crate::rules::{validate_permissions, ProgramPermission, Reader};

/// Any instruction that changes `phygital_token.owner` must call
/// `close_policy_if_exists`.
#[account]
#[derive(Debug)]
pub struct AccessoryPolicy {
    pub phygital_token: Pubkey,
    pub wallet: Pubkey,
    pub sol_cap: Option<SpendCap>,
    pub mint_caps: Vec<MintCap>,
    /// Empty = any. Only binds browser taps: a client talking CTAP2 to the
    /// accessory directly writes its own `clientDataJSON.origin`.
    pub allowed_origins: Vec<String>,
    pub program_permissions: Vec<ProgramPermission>,
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    bytemuck::Pod,
    bytemuck::Zeroable,
)]
#[repr(C)]
pub struct SpendCap {
    pub cap: u64,
    pub remaining: u64,
    pub last_reset: i64,
    /// `0` = a lifetime cap.
    pub window_seconds: i64,
    /// `0` = no per-execute limit.
    pub max_per_tx: u64,
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    bytemuck::Pod,
    bytemuck::Zeroable,
)]
#[repr(C)]
pub struct MintCap {
    pub mint: Pubkey,
    pub cap: SpendCap,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct CapArg {
    pub cap: u64,
    pub window_seconds: i64,
    pub max_per_tx: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum PolicyAction {
    SetSolCap(Option<CapArg>),
    SetMintCap(Pubkey, CapArg),
    RemoveMintCap(Pubkey),
    SetAllowedOrigins(Vec<String>),
    SetProgramPermission(ProgramPermission),
    RemoveProgramPermission(Pubkey),
}

impl AccessoryPolicy {
    pub fn apply(&mut self, actions: Vec<PolicyAction>, now: i64) -> Result<()> {
        for action in actions {
            match action {
                PolicyAction::SetSolCap(arg) => {
                    self.sol_cap = match arg {
                        Some(arg) => Some(SpendCap::new(&arg, now)?.keep_usage(self.sol_cap)),
                        None => None,
                    }
                }
                PolicyAction::SetMintCap(mint, arg) => {
                    require!(
                        mint != Pubkey::default() && !is_wsol_mint(&mint),
                        PhygitalError::InvalidPolicyArgs
                    );
                    let new = SpendCap::new(&arg, now)?;
                    match self.mint_caps.iter_mut().find(|m| m.mint == mint) {
                        Some(existing) => existing.cap = new.keep_usage(Some(existing.cap)),
                        None => self.mint_caps.push(MintCap { mint, cap: new }),
                    }
                }
                PolicyAction::RemoveMintCap(mint) => {
                    let len = self.mint_caps.len();
                    self.mint_caps.retain(|m| m.mint != mint);
                    require!(self.mint_caps.len() < len, PhygitalError::InvalidPolicyArgs);
                }
                PolicyAction::SetAllowedOrigins(origins) => {
                    for (i, origin) in origins.iter().enumerate() {
                        require!(
                            is_valid_origin(origin) && !origins[..i].contains(origin),
                            PhygitalError::InvalidPolicyArgs
                        );
                    }
                    self.allowed_origins = origins;
                }
                PolicyAction::SetProgramPermission(permission) => {
                    match self
                        .program_permissions
                        .iter_mut()
                        .find(|p| p.program_id == permission.program_id)
                    {
                        Some(existing) => *existing = permission,
                        None => self.program_permissions.push(permission),
                    }
                }
                PolicyAction::RemoveProgramPermission(program_id) => {
                    let len = self.program_permissions.len();
                    self.program_permissions
                        .retain(|p| p.program_id != program_id);
                    require!(
                        self.program_permissions.len() < len,
                        PhygitalError::InvalidPolicyArgs
                    );
                }
            }
        }
        validate_permissions(&self.program_permissions)
    }
}

impl SpendCap {
    fn new(arg: &CapArg, now: i64) -> Result<Self> {
        require!(
            arg.cap > 0
                && arg.window_seconds >= 0
                && (arg.max_per_tx == 0 || arg.max_per_tx <= arg.cap),
            PhygitalError::InvalidPolicyArgs
        );
        Ok(Self {
            cap: arg.cap,
            remaining: arg.cap,
            last_reset: window_start(now, arg.window_seconds),
            window_seconds: arg.window_seconds,
            max_per_tx: arg.max_per_tx,
        })
    }

    fn keep_usage(self, previous: Option<SpendCap>) -> Self {
        match previous {
            Some(prev)
                if (prev.cap, prev.window_seconds, prev.max_per_tx)
                    == (self.cap, self.window_seconds, self.max_per_tx) =>
            {
                prev
            }
            _ => self,
        }
    }

    pub(crate) fn charge(&mut self, amount: u64, now: i64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        require!(
            self.max_per_tx == 0 || amount <= self.max_per_tx,
            PhygitalError::MaxPerTxExceeded
        );
        // `last_reset` is always window-aligned, so a later aligned start
        // means at least one full window has passed.
        let start = window_start(now, self.window_seconds);
        if self.window_seconds > 0 && start > self.last_reset {
            self.last_reset = start;
            self.remaining = self.cap;
        }
        self.remaining = self
            .remaining
            .checked_sub(amount)
            .ok_or_else(|| error!(PhygitalError::SpendLimitExceeded))?;
        Ok(())
    }
}

/// The exact form browsers write: no path, trailing slash or uppercase.
fn is_valid_origin(origin: &str) -> bool {
    let host = match origin.strip_prefix("https://") {
        Some(host) => host,
        None => match origin.strip_prefix("http://") {
            Some(host) if host == "localhost" || host.starts_with("localhost:") => host,
            _ => return false,
        },
    };
    let (name, port) = match host.split_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (host, None),
    };
    !name.is_empty()
        && !name.starts_with(['.', '-'])
        && !name.ends_with(['.', '-'])
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && port
            .is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()))
}

fn window_start(now: i64, window_seconds: i64) -> i64 {
    if window_seconds > 0 {
        now - now.rem_euclid(window_seconds)
    } else {
        now
    }
}

// Borsh encodes `SpendCap` / `MintCap` exactly as their `repr(C)` bytes.
const _: () = assert!(core::mem::size_of::<SpendCap>() == 40);
const _: () = assert!(core::mem::size_of::<MintCap>() == 72);
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
