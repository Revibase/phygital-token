//! One file per instruction: its `Accounts` struct (with the constraints that
//! enforce who may call it) and its handler. Shared logic lives in
//! [`crate::webauthn`] and [`crate::spend`].

mod admin;
mod merchant;
mod pay;
mod token;

pub use admin::*;
pub use merchant::*;
pub use pay::*;
pub use token::*;
