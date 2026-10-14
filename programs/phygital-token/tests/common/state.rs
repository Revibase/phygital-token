//! Reading token state back from the SVM.

use super::*;

impl TestContext {
    pub(super) fn load_phygital_token(&self, phygital_token: Pubkey) -> PhygitalToken {
        let account = self
            .svm
            .get_account(&phygital_token)
            .expect("phygital_token account");
        PhygitalToken::try_deserialize(&mut account.data.as_ref())
            .expect("deserialize phygital_token")
    }

    /// The token's owner, or `fallback` if it has none (or does not exist).
    pub fn owner_or(&self, phygital_token: Pubkey, fallback: Pubkey) -> Pubkey {
        self.svm
            .get_account(&phygital_token)
            .and_then(|account| PhygitalToken::try_deserialize(&mut account.data.as_ref()).ok())
            .map(|token| token.owner)
            .filter(|owner| *owner != Pubkey::default())
            .unwrap_or(fallback)
    }

    pub fn phygital_token_owner(&self, phygital_token: Pubkey) -> Pubkey {
        self.load_phygital_token(phygital_token).owner
    }

    pub fn phygital_token_lock_state(&self, phygital_token: Pubkey) -> bool {
        self.load_phygital_token(phygital_token).is_locked()
    }

    pub fn last_sign_count(&self, phygital_token: Pubkey) -> u32 {
        self.load_phygital_token(phygital_token).last_sign_count
    }

    pub fn phygital_token_mint(&self, phygital_token: Pubkey) -> Pubkey {
        self.load_phygital_token(phygital_token).mint
    }

    /// Next WebAuthn signCount to use for a successful assertion against `phygital_token`.
    pub fn next_sign_count(&self, phygital_token: Pubkey) -> u32 {
        self.load_phygital_token(phygital_token)
            .last_sign_count
            .saturating_add(1)
    }

    pub fn phygital_token_account(&self, phygital_token: Pubkey) -> PhygitalToken {
        self.load_phygital_token(phygital_token)
    }
}
