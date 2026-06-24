/// Per-asset delegate PDA `[SPEND_AUTHORITY_SEED, asset]` (under this program's id) that owners
/// approve as the SPL delegate on their token account. Scoped per asset so only the approved
/// asset's passkey can draw the budget.
pub const SPEND_AUTHORITY_SEED: &[u8] = b"spend_authority";
