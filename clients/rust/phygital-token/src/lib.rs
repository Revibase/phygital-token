//! Codama-generated Rust client for the `phygital-token` program.
//!
//! The contents of `generated/` are produced by `codama run rust` (see `codama.json`) — do not
//! edit them by hand. This crate re-exports the generated program id, account types, instruction
//! data/args, and error types so other crates can consume them on-chain
//! without depending on the `phygital-token` program crate directly.

pub mod generated;

pub use generated::accounts::*;
pub use generated::errors::*;
pub use generated::instructions::*;
pub use generated::programs::*;
pub use generated::types::*;
