//! One accessory's tap-payment limits, a PDA at `[SPEND_POLICY_SEED, phygital_token]`.
//!
//! - `daily_limits`: per mint, how much may be paid per day (resetting at the
//!   owner's local midnight, `reset_offset` seconds east of UTC) and,
//!   optionally, per tap. A mint without one cannot be paid.
//! - `allowed_payees`: wallets other than verified merchants' that the owner
//!   lets the accessory pay, for a time or a number of payments. They share
//!   the daily limits.
//!
//! The policy belongs to the owner who created it: every change of owner
//! closes it (`set_owner`, `remove_owner`, `close_phygital_token`).

use anchor_lang::prelude::*;

pub const MAX_DAILY_LIMITS: usize = 8;
pub const MAX_ALLOWED_PAYEES: usize = 16;
pub const SECONDS_PER_DAY: i64 = 86_400;
/// Timezones run from UTC-12 to UTC+14.
pub const MAX_RESET_OFFSET: i32 = 14 * 3_600;
/// `uses_left` value for a payee allowed without a use limit.
pub const UNLIMITED_USES: u32 = u32::MAX;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub struct DailyLimit {
    pub mint: Pubkey,
    /// Raw token units per day.
    pub limit: u64,
    /// Spent since `day_start`.
    pub spent: u64,
    /// Start of the day `spent` counts, as a Unix timestamp.
    pub day_start: i64,
    /// Raw token units per tap; `0` means no separate limit.
    pub max_per_tap: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub struct AllowedPayee {
    pub payee: Pubkey,
    /// Unix timestamp after which the entry no longer applies; `0` = never.
    pub expires_at: i64,
    /// Payments left; [`UNLIMITED_USES`] = no limit.
    pub uses_left: u32,
}

impl AllowedPayee {
    pub fn is_active(&self, now: i64) -> bool {
        self.uses_left > 0 && (self.expires_at == 0 || now < self.expires_at)
    }
}

#[account]
#[derive(Debug)]
pub struct SpendPolicy {
    pub phygital_token: Pubkey,
    /// The owner who created it; always the token's current owner.
    pub owner: Pubkey,
    pub bump: u8,
    pub paused: bool,
    /// Seconds east of UTC at which the owner's day starts.
    pub reset_offset: i32,
    pub daily_limits: Vec<DailyLimit>,
    pub allowed_payees: Vec<AllowedPayee>,
}

/// Start of the day containing `now` for a day beginning `reset_offset`
/// seconds east of UTC.
pub fn day_start(now: i64, reset_offset: i32) -> i64 {
    let local = now.saturating_add(i64::from(reset_offset));
    local - local.rem_euclid(SECONDS_PER_DAY) - i64::from(reset_offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_starts_at_local_midnight() {
        // 2026-10-14T01:00:00Z is 09:00 in UTC+8: that day began at 16:00Z the day before.
        let now = 1_791_939_600;
        assert_eq!(day_start(now, 0), now - 3_600);
        assert_eq!(day_start(now, 8 * 3_600), now - 3_600 - 8 * 3_600);
        assert_eq!(day_start(now, -5 * 3_600), now - 3_600 - 19 * 3_600);
    }
}
