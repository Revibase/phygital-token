//! Running instructions as the wallet PDA.

mod execute_with_accessory;
mod execute_with_owner;
mod preview_execute;

pub use execute_with_accessory::*;
pub use execute_with_owner::*;
pub use preview_execute::*;
