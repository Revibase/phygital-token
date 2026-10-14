//! Editing a [`SpendPolicy`] and charging payments against it.

use anchor_lang::prelude::*;

use crate::error::PhygitalError;
use crate::state::{
    day_start, AllowedPayee, DailyLimit, SpendPolicy, MAX_ALLOWED_PAYEES, MAX_DAILY_LIMITS,
    MAX_RESET_OFFSET, UNLIMITED_USES,
};

/// One `update_spend_policy` edit. Edits apply in order.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum SpendPolicyAction {
    /// Adds or changes a mint's limits. Today's spending is kept.
    SetDailyLimit {
        mint: Pubkey,
        limit: u64,
        /// `0` = no separate per-tap limit.
        max_per_tap: u64,
    },
    RemoveDailyLimit {
        mint: Pubkey,
    },
    /// Adds or replaces an allowed payee.
    AllowPayee {
        payee: Pubkey,
        /// `0` = never expires.
        expires_at: i64,
        /// `None` = no use limit.
        uses: Option<u32>,
    },
    RemovePayee {
        payee: Pubkey,
    },
    /// Seconds east of UTC at which the owner's day starts.
    SetTimezone {
        reset_offset: i32,
    },
    SetPaused {
        paused: bool,
    },
}

impl SpendPolicy {
    /// Applies `actions`, then drops allowed payees that expired or are used up.
    pub(crate) fn apply(&mut self, actions: Vec<SpendPolicyAction>, now: i64) -> Result<()> {
        for action in actions {
            match action {
                SpendPolicyAction::SetDailyLimit {
                    mint,
                    limit,
                    max_per_tap,
                } => {
                    require!(
                        mint != Pubkey::default() && limit > 0 && max_per_tap <= limit,
                        PhygitalError::InvalidPolicyArgs
                    );
                    match self.daily_limits.iter_mut().find(|l| l.mint == mint) {
                        Some(existing) => {
                            existing.limit = limit;
                            existing.max_per_tap = max_per_tap;
                        }
                        None => {
                            require!(
                                self.daily_limits.len() < MAX_DAILY_LIMITS,
                                PhygitalError::InvalidPolicyArgs
                            );
                            self.daily_limits.push(DailyLimit {
                                mint,
                                limit,
                                spent: 0,
                                day_start: day_start(now, self.reset_offset),
                                max_per_tap,
                            });
                        }
                    }
                }
                SpendPolicyAction::RemoveDailyLimit { mint } => {
                    let index = self
                        .daily_limits
                        .iter()
                        .position(|l| l.mint == mint)
                        .ok_or_else(|| error!(PhygitalError::InvalidPolicyArgs))?;
                    self.daily_limits.swap_remove(index);
                }
                SpendPolicyAction::AllowPayee {
                    payee,
                    expires_at,
                    uses,
                } => {
                    require!(
                        payee != Pubkey::default()
                            && (expires_at == 0 || expires_at > now)
                            && !matches!(uses, Some(0) | Some(UNLIMITED_USES)),
                        PhygitalError::InvalidPolicyArgs
                    );
                    let entry = AllowedPayee {
                        payee,
                        expires_at,
                        uses_left: uses.unwrap_or(UNLIMITED_USES),
                    };
                    match self.allowed_payees.iter_mut().find(|p| p.payee == payee) {
                        Some(existing) => *existing = entry,
                        None => {
                            require!(
                                self.allowed_payees.len() < MAX_ALLOWED_PAYEES,
                                PhygitalError::InvalidPolicyArgs
                            );
                            self.allowed_payees.push(entry);
                        }
                    }
                }
                SpendPolicyAction::RemovePayee { payee } => {
                    let index = self
                        .allowed_payees
                        .iter()
                        .position(|p| p.payee == payee)
                        .ok_or_else(|| error!(PhygitalError::InvalidPolicyArgs))?;
                    self.allowed_payees.swap_remove(index);
                }
                SpendPolicyAction::SetTimezone { reset_offset } => {
                    require!(
                        (-MAX_RESET_OFFSET..=MAX_RESET_OFFSET).contains(&reset_offset),
                        PhygitalError::InvalidPolicyArgs
                    );
                    self.reset_offset = reset_offset;
                }
                SpendPolicyAction::SetPaused { paused } => self.paused = paused,
            }
        }
        self.allowed_payees.retain(|p| p.is_active(now));
        Ok(())
    }

    /// Charges `amount` of `mint` against today's limit.
    pub(crate) fn charge(&mut self, mint: &Pubkey, amount: u64, now: i64) -> Result<()> {
        let today = day_start(now, self.reset_offset);
        let limit = self
            .daily_limits
            .iter_mut()
            .find(|l| l.mint == *mint)
            .ok_or_else(|| error!(PhygitalError::SpendNotAllowed))?;
        require!(
            limit.max_per_tap == 0 || amount <= limit.max_per_tap,
            PhygitalError::MaxPerTxExceeded
        );
        // A timezone change can move today's start either way; any other
        // start means a new day.
        if limit.day_start != today {
            limit.day_start = today;
            limit.spent = 0;
        }
        let spent = limit
            .spent
            .checked_add(amount)
            .filter(|spent| *spent <= limit.limit)
            .ok_or_else(|| error!(PhygitalError::SpendLimitExceeded))?;
        limit.spent = spent;
        Ok(())
    }

    /// Uses up one payment of the active allowed-payee entry for `payee`, if any.
    pub(crate) fn use_allowed_payee(&mut self, payee: &Pubkey, now: i64) -> bool {
        match self
            .allowed_payees
            .iter_mut()
            .find(|p| p.payee == *payee && p.is_active(now))
        {
            Some(entry) => {
                if entry.uses_left != UNLIMITED_USES {
                    entry.uses_left -= 1;
                }
                true
            }
            None => false,
        }
    }

    /// Today's remaining allowance for `mint` (after a successful charge).
    pub(crate) fn remaining_today(&self, mint: &Pubkey) -> u64 {
        self.daily_limits
            .iter()
            .find(|l| l.mint == *mint)
            .map_or(0, |l| l.limit.saturating_sub(l.spent))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_791_939_600;

    fn policy() -> SpendPolicy {
        SpendPolicy {
            phygital_token: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            bump: 255,
            paused: false,
            reset_offset: 0,
            daily_limits: Vec::new(),
            allowed_payees: Vec::new(),
        }
    }

    fn set_limit(mint: Pubkey, limit: u64, max_per_tap: u64) -> SpendPolicyAction {
        SpendPolicyAction::SetDailyLimit {
            mint,
            limit,
            max_per_tap,
        }
    }

    #[test]
    fn charges_within_the_day_and_resets_at_midnight() {
        let mint = Pubkey::new_unique();
        let mut p = policy();
        p.apply(vec![set_limit(mint, 100, 40)], NOW).unwrap();
        p.charge(&mint, 40, NOW).unwrap();
        assert!(p.charge(&mint, 41, NOW).is_err(), "over max per tap");
        p.charge(&mint, 40, NOW).unwrap();
        assert!(p.charge(&mint, 21, NOW).is_err(), "over the daily limit");
        p.charge(&mint, 20, NOW).unwrap();
        assert_eq!(p.remaining_today(&mint), 0);
        p.charge(&mint, 30, NOW + 86_400).unwrap();
        assert_eq!(p.remaining_today(&mint), 70);
    }

    #[test]
    fn changing_a_limit_keeps_todays_spending() {
        let mint = Pubkey::new_unique();
        let mut p = policy();
        p.apply(vec![set_limit(mint, 100, 0)], NOW).unwrap();
        p.charge(&mint, 60, NOW).unwrap();
        p.apply(vec![set_limit(mint, 80, 0)], NOW).unwrap();
        assert!(p.charge(&mint, 30, NOW).is_err());
        p.charge(&mint, 20, NOW).unwrap();
    }

    #[test]
    fn unknown_mint_is_not_allowed() {
        assert!(policy().charge(&Pubkey::new_unique(), 1, NOW).is_err());
    }

    #[test]
    fn rejects_invalid_edits() {
        let mint = Pubkey::new_unique();
        for action in [
            set_limit(mint, 0, 0),
            set_limit(mint, 10, 11),
            set_limit(Pubkey::default(), 10, 0),
            SpendPolicyAction::RemoveDailyLimit { mint },
            SpendPolicyAction::AllowPayee {
                payee: mint,
                expires_at: NOW,
                uses: None,
            },
            SpendPolicyAction::AllowPayee {
                payee: mint,
                expires_at: 0,
                uses: Some(0),
            },
            SpendPolicyAction::SetTimezone {
                reset_offset: MAX_RESET_OFFSET + 1,
            },
        ] {
            assert!(policy().apply(vec![action], NOW).is_err());
        }
        let too_many = (0..=MAX_DAILY_LIMITS)
            .map(|_| set_limit(Pubkey::new_unique(), 1, 0))
            .collect();
        assert!(policy().apply(too_many, NOW).is_err());
    }

    #[test]
    fn allowed_payees_expire_and_run_out() {
        let once = Pubkey::new_unique();
        let today = Pubkey::new_unique();
        let mut p = policy();
        p.apply(
            vec![
                SpendPolicyAction::AllowPayee {
                    payee: once,
                    expires_at: 0,
                    uses: Some(1),
                },
                SpendPolicyAction::AllowPayee {
                    payee: today,
                    expires_at: NOW + 60,
                    uses: None,
                },
            ],
            NOW,
        )
        .unwrap();
        assert!(p.use_allowed_payee(&once, NOW));
        assert!(!p.use_allowed_payee(&once, NOW));
        assert!(p.use_allowed_payee(&today, NOW + 59));
        assert!(!p.use_allowed_payee(&today, NOW + 60));
        // The next edit prunes both.
        p.apply(Vec::new(), NOW + 60).unwrap();
        assert!(p.allowed_payees.is_empty());
    }
}
