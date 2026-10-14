//! The verified-merchant registry, written only by the registrar.

mod close_merchant;
mod register_merchant;
mod update_merchant;

pub use close_merchant::*;
pub use register_merchant::*;
pub use update_merchant::*;
