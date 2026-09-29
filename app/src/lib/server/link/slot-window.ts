/**
 * How long a tap over a freshly fetched slot hash stays usable.
 *
 * `set_linked_wallet` looks the slot up in SlotHashes (512 entries) at execution, so
 * the hash survives 511 more blocks; we stop 20 blocks early so a signature made at
 * the last second can still land. Real slots run slower than the 200 ms assumed here
 * and skipped slots don't use up entries, so this is conservative. It is added to the
 * fetch time once and only drives the countdown — the program is the final authority.
 */
export const TAP_WINDOW_MS = (511 - 20) * 200;
