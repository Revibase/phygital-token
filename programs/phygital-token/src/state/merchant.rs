//! A verified merchant, a PDA at `[MERCHANT_SEED, merchant_key]`, written only
//! by the registrar.
//!
//! The merchant co-signs every tap payment with `merchant_key`, and that key is
//! part of the tap's challenge. The registry ties the key to the wallets that
//! may receive its payments and to the domain and name the registrar checked,
//! so anyone can tell which merchant a payment came from.

use anchor_lang::prelude::*;

pub const MAX_MERCHANT_PAYEES: usize = 4;
pub const MAX_MERCHANT_DOMAIN_LEN: usize = 64;
pub const MAX_MERCHANT_NAME_LEN: usize = 32;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MerchantStatus {
    Active,
    Suspended,
}

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub merchant_key: Pubkey,
    pub bump: u8,
    pub status: MerchantStatus,
    /// Owners of the token accounts its payments may go to.
    #[max_len(MAX_MERCHANT_PAYEES)]
    pub payees: Vec<Pubkey>,
    /// Hostname the registrar verified (`/.well-known/revibase-merchant.json`).
    #[max_len(MAX_MERCHANT_DOMAIN_LEN)]
    pub domain: String,
    /// Display name.
    #[max_len(MAX_MERCHANT_NAME_LEN)]
    pub name: String,
    pub registered_at: i64,
}

impl Merchant {
    /// Whether a payment to a token account owned by `payee` counts as this
    /// merchant's.
    pub fn accepts(&self, payee: &Pubkey) -> bool {
        self.status == MerchantStatus::Active && self.payees.contains(payee)
    }
}

/// What the registrar records about a merchant.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MerchantArgs {
    pub payees: Vec<Pubkey>,
    pub domain: String,
    pub name: String,
}

impl MerchantArgs {
    pub fn validate(&self) -> Result<()> {
        let payees_ok =
            !self.payees.is_empty()
                && self.payees.len() <= MAX_MERCHANT_PAYEES
                && self.payees.iter().enumerate().all(|(i, payee)| {
                    *payee != Pubkey::default() && !self.payees[..i].contains(payee)
                });
        let name_ok = !self.name.is_empty()
            && self.name.len() <= MAX_MERCHANT_NAME_LEN
            && !self.name.chars().any(char::is_control);
        require!(
            payees_ok && name_ok && is_valid_hostname(&self.domain),
            crate::error::PhygitalError::InvalidMerchantArgs
        );
        Ok(())
    }
}

/// A lowercase DNS hostname: labels of `[a-z0-9-]` separated by dots, none
/// empty or starting or ending with `-`.
pub fn is_valid_hostname(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= MAX_MERCHANT_DOMAIN_LEN
        && host.split('.').all(|label| {
            !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostnames() {
        for ok in ["cafeluna.com", "pay.shop-1.example", "localhost"] {
            assert!(is_valid_hostname(ok), "{ok}");
        }
        for bad in [
            "",
            "Cafe.com",
            "a..b",
            "-a.com",
            "a-.com",
            "a.com.",
            "https://a.com",
            "a.com/x",
            "caf\u{e9}.com",
        ] {
            assert!(!is_valid_hostname(bad), "{bad}");
        }
    }

    #[test]
    fn merchant_args() {
        let payee = Pubkey::new_unique();
        let args = |payees: Vec<Pubkey>, name: &str| MerchantArgs {
            payees,
            domain: "cafe.example".into(),
            name: name.into(),
        };
        assert!(args(vec![payee], "Caf\u{e9} Luna").validate().is_ok());
        assert!(args(vec![], "Cafe").validate().is_err());
        assert!(args(vec![payee, payee], "Cafe").validate().is_err());
        assert!(args(vec![Pubkey::default()], "Cafe").validate().is_err());
        assert!(args(vec![payee; 1], "").validate().is_err());
        assert!(args(vec![payee], "a\nb").validate().is_err());
        assert!(args((0..5).map(|_| Pubkey::new_unique()).collect(), "Cafe")
            .validate()
            .is_err());
    }
}
