//! One file per instruction: its `Accounts` struct (with the constraints that
//! enforce who may call it) and its handler. Shared logic lives in
//! [`crate::tap`].

mod admin;
mod token;

pub use admin::*;
pub use token::*;
