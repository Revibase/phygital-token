//! Codama-generated Rust client for the `phygital-token` program.
//!
//! The contents of `generated/` are produced by `codama run rust` (see `codama.json`) — do not
//! edit them by hand. This crate re-exports the generated program id, account types, instruction
//! data/args, and error types so other crates can consume them on-chain
//! without depending on the `phygital-token` program crate directly.
//!
//! `VerifyCpiBuilder` optional args: `.expected_rp_id(...)` and `.expected_origins(...)`.
//! Omit them to skip those checks. When `expected_origins` is set, the signed
//! origin must match one listed origin.

// Generated code is not held to the workspace lints: Codama's instruction builders
// `expect()` required fields by design, and the renderer emits a few unused items.
#[allow(clippy::all, clippy::unwrap_used, clippy::expect_used, unused)]
pub mod generated;

pub use generated::accounts::*;
pub use generated::errors::*;
pub use generated::instructions::*;
pub use generated::programs::*;
pub use generated::types::*;
pub use generated::{accounts, errors, instructions, programs, types};
