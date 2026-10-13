//! Reading SPL Token and Token-2022 token accounts in place.
//!
//! SPL Token account layout (165 bytes; Token-2022 uses the same base layout,
//! followed by an account-type byte and extensions):
//!
//! | Bytes      | Field                                   |
//! |------------|-----------------------------------------|
//! | 0..32      | mint                                    |
//! | 32..64     | owner                                   |
//! | 64..72     | amount (`u64`)                          |
//! | 72..108    | delegate (`COption<Pubkey>`)            |
//! | 108        | state (0 uninitialized, 1 initialized, 2 frozen) |
//! | 109..121   | is_native (`COption<u64>`)              |
//! | 121..129   | delegated_amount (`u64`)                |
//! | 129..165   | close_authority (`COption<Pubkey>`)     |
//! | 165        | Token-2022 account type (2 = account)   |

use anchor_lang::prelude::*;

use crate::constants::{SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID};

const MINT: usize = 0;
const OWNER: usize = 32;
const AMOUNT: usize = 64;
const DELEGATE: usize = 72;
const STATE: usize = 108;
const DELEGATED_AMOUNT: usize = 121;
const CLOSE_AUTHORITY: usize = 129;
/// Length of the base account; also where Token-2022 stores the account type.
const BASE_LEN: usize = 165;
const ACCOUNT_TYPE: usize = BASE_LEN;
const ACCOUNT_TYPE_ACCOUNT: u8 = 2;
const STATE_INITIALIZED: u8 = 1;
const STATE_FROZEN: u8 = 2;
/// `COption::Some` tag (a little-endian `u32`).
const COPTION_SOME: [u8; 4] = [1, 0, 0, 0];

pub(super) fn is_token_program(owner: &Pubkey) -> bool {
    *owner == SPL_TOKEN_PROGRAM_ID || *owner == TOKEN_2022_PROGRAM_ID
}

pub(super) struct TokenView {
    pub(super) mint: Pubkey,
    pub(super) owner: Pubkey,
    pub(super) amount: u64,
    pub(super) delegate: Option<Pubkey>,
    pub(super) delegated_amount: u64,
    pub(super) close_authority: Option<Pubkey>,
}

/// The fields this program uses, or `None` for anything that is not an
/// initialized (or frozen) token account. The caller checks the owning program
/// with [`is_token_program`].
pub(super) fn token_account_view(data: &[u8]) -> Option<TokenView> {
    if data.len() < BASE_LEN
        || (data.len() > BASE_LEN && data[ACCOUNT_TYPE] != ACCOUNT_TYPE_ACCOUNT)
        || !matches!(data[STATE], STATE_INITIALIZED | STATE_FROZEN)
    {
        return None;
    }
    let pubkey = |at: usize| Pubkey::try_from(&data[at..at + 32]).ok();
    let coption = |at: usize| {
        (data[at..at + 4] == COPTION_SOME)
            .then(|| pubkey(at + 4))
            .flatten()
    };
    let u64_at = |at: usize| data[at..at + 8].try_into().ok().map(u64::from_le_bytes);
    Some(TokenView {
        mint: pubkey(MINT)?,
        owner: pubkey(OWNER)?,
        amount: u64_at(AMOUNT)?,
        delegate: coption(DELEGATE),
        delegated_amount: u64_at(DELEGATED_AMOUNT)?,
        close_authority: coption(CLOSE_AUTHORITY),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn account(len: usize) -> Vec<u8> {
        let mut data = vec![0u8; len];
        data[MINT..MINT + 32].copy_from_slice(&[1; 32]);
        data[OWNER..OWNER + 32].copy_from_slice(&[2; 32]);
        data[AMOUNT..AMOUNT + 8].copy_from_slice(&500u64.to_le_bytes());
        data[STATE] = STATE_INITIALIZED;
        data[CLOSE_AUTHORITY..CLOSE_AUTHORITY + 4].copy_from_slice(&COPTION_SOME);
        data[CLOSE_AUTHORITY + 4..CLOSE_AUTHORITY + 36].copy_from_slice(&[3; 32]);
        data
    }

    #[test]
    fn reads_an_spl_token_account() {
        let view = token_account_view(&account(BASE_LEN)).unwrap();
        assert_eq!(view.mint, Pubkey::new_from_array([1; 32]));
        assert_eq!(view.owner, Pubkey::new_from_array([2; 32]));
        assert_eq!(view.amount, 500);
        assert_eq!(view.delegate, None);
        assert_eq!(view.close_authority, Some(Pubkey::new_from_array([3; 32])));
    }

    #[test]
    fn requires_the_token_2022_account_type_and_an_initialized_state() {
        let mut extended = account(BASE_LEN + 10);
        assert!(token_account_view(&extended).is_none());
        extended[ACCOUNT_TYPE] = ACCOUNT_TYPE_ACCOUNT;
        assert!(token_account_view(&extended).is_some());
        let mut uninitialized = account(BASE_LEN);
        uninitialized[STATE] = 0;
        assert!(token_account_view(&uninitialized).is_none());
        assert!(token_account_view(&account(BASE_LEN)[..BASE_LEN - 1]).is_none());
    }

    proptest! {
        #[test]
        fn never_panics(data in proptest::collection::vec(any::<u8>(), 0..400)) {
            let _ = token_account_view(&data);
        }
    }
}
