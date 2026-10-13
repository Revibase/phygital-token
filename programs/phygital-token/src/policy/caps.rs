//! Spend caps: how much SOL or one token the accessory may move.
//!
//! A cap allows `cap` units per window of `window_seconds` (`0` = once, for the
//! policy's lifetime) and at most `max_per_tx` per execute (`0` = no limit).
//! Windows are aligned to multiples of `window_seconds` since the Unix epoch,
//! so usage resets at the first charge in a new window rather than sliding.

use anchor_lang::prelude::*;

use crate::error::PhygitalError;
use crate::state::SpendCap;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct CapArg {
    pub cap: u64,
    pub window_seconds: i64,
    pub max_per_tx: u64,
}

impl SpendCap {
    pub(super) fn new(arg: &CapArg, now: i64) -> Result<Self> {
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

    pub(super) fn keep_usage(self, previous: Option<SpendCap>) -> Self {
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

fn window_start(now: i64, window_seconds: i64) -> i64 {
    if window_seconds > 0 {
        now - now.rem_euclid(window_seconds)
    } else {
        now
    }
}
