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

const MINT: usize = 0;
const OWNER: usize = 32;
const DELEGATE: usize = 72;
const STATE: usize = 108;
#[cfg(test)]
const AMOUNT: usize = 64;
#[cfg(test)]
const CLOSE_AUTHORITY: usize = 129;
/// Length of the base account; also where Token-2022 stores the account type.
const BASE_LEN: usize = 165;
const ACCOUNT_TYPE: usize = BASE_LEN;
const ACCOUNT_TYPE_ACCOUNT: u8 = 2;
const STATE_INITIALIZED: u8 = 1;
const STATE_FROZEN: u8 = 2;
/// SPL Token and Token-2022 multisig accounts are exactly this long. Token-2022
/// never sizes a token account to it, so the length alone tells them apart.
const MULTISIG_LEN: usize = 355;
/// `COption::Some` tag (a little-endian `u32`).
const COPTION_SOME: [u8; 4] = [1, 0, 0, 0];

pub(crate) struct TokenView {
    pub(crate) mint: Pubkey,
    pub(crate) owner: Pubkey,
    pub(crate) delegate: Option<Pubkey>,
}

/// The fields this program uses, or `None` for anything that is not an
/// initialized (or frozen) token account. The caller checks the owning program
/// with [`crate::constants::is_token_program`].
pub(crate) fn token_account_view(data: &[u8]) -> Option<TokenView> {
    if data.len() < BASE_LEN
        || data.len() == MULTISIG_LEN
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
    Some(TokenView {
        mint: pubkey(MINT)?,
        owner: pubkey(OWNER)?,
        delegate: coption(DELEGATE),
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
        assert_eq!(view.delegate, None);
    }

    #[test]
    fn reads_the_delegate() {
        let mut data = account(BASE_LEN);
        data[DELEGATE..DELEGATE + 4].copy_from_slice(&COPTION_SOME);
        data[DELEGATE + 4..DELEGATE + 36].copy_from_slice(&[9; 32]);
        let view = token_account_view(&data).unwrap();
        assert_eq!(view.delegate, Some(Pubkey::new_from_array([9; 32])));
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

    /// A multisig's signer list is chosen freely, so its bytes can be arranged to
    /// read like a token account owned by anyone.
    #[test]
    fn rejects_a_multisig_shaped_like_a_token_account() {
        let mut multisig = account(MULTISIG_LEN);
        multisig[CLOSE_AUTHORITY..CLOSE_AUTHORITY + 4].copy_from_slice(&[0; 4]);
        multisig[ACCOUNT_TYPE] = ACCOUNT_TYPE_ACCOUNT;
        assert!(token_account_view(&multisig).is_none());
    }

    proptest! {
        #[test]
        fn never_panics(data in proptest::collection::vec(any::<u8>(), 0..400)) {
            let _ = token_account_view(&data);
        }
    }
}
