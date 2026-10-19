//! Slot control.

use super::*;

impl TestContext {
    pub fn set_current_slot(&mut self, slot: u64) {
        use solana_slot_hashes::SlotHashes;

        self.svm.warp_to_slot(slot);
        let hash = solana_message::Hash::new_from_array([slot as u8; 32]);
        self.svm.set_sysvar(&SlotHashes::new(&[(slot, hash)]));
    }
}
