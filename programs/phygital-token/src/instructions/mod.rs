//! One file per instruction: its `Accounts` struct (with the constraints that
//! enforce who may call it) and its handler. Shared logic lives in
//! [`crate::webauthn`], [`crate::wallet`] and [`crate::policy`].

mod admin;
mod execute;
mod policy;
mod token;

pub use admin::*;
pub use execute::*;
pub use policy::*;
pub use token::*;
