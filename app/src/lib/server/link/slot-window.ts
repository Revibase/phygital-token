import type { Rpc, SolanaRpcApi } from '@solana/kit';

import { base64ToBytes } from '$lib/shared/encoding';
import { SLOT_HASHES_SYSVAR } from '$lib/shared/link-transaction';

/** The SlotHashes sysvar keeps the most recent 512 (slot, hash) entries, newest first. */
export const SLOT_HASHES_MAX_ENTRIES = 512;

/**
 * Stop using a tap this many blocks before its slot hash is evicted, so a
 * transaction signed at the last moment still has time to land.
 */
export const LANDING_MARGIN_SLOTS = 20;

/** Solana slot time used to turn remaining SlotHashes positions into wall-clock time. */
export const MS_PER_SLOT = 200;
const SYSVAR_CACHE_MS = 2_000;

export type TapWindow = {
	/** The tap's slot hash is still in SlotHashes, with room to land a transaction. */
	alive: boolean;
	/** New blocks the tap can still absorb before the landing cut-off. */
	remainingSlots: number;
	/** Wall-clock estimate of the landing cut-off (SlotHashes eviction − margin). */
	expiresAt: number;
	/** Length of the whole usable window, for progress display. */
	totalMs: number;
};

let sysvarCache: { at: number; bytes: Uint8Array } | null = null;

async function slotHashes(rpc: Rpc<SolanaRpcApi>, now: number): Promise<Uint8Array> {
	if (sysvarCache && now - sysvarCache.at < SYSVAR_CACHE_MS) return sysvarCache.bytes;
	const { value } = await rpc.getAccountInfo(SLOT_HASHES_SYSVAR, { encoding: 'base64', commitment: 'confirmed' }).send();
	if (!value) throw new Error('SlotHashes sysvar unavailable');
	const bytes = base64ToBytes(value.data[0]);
	sysvarCache = { at: now, bytes };
	return bytes;
}

/**
 * Index of `slot` in SlotHashes (0 = newest), mirroring the program's binary
 * search over the descending entries. Returns -1 when it is no longer present,
 * and 0 when it is newer than anything the RPC has seen yet.
 */
export function slotHashIndex(data: Uint8Array, slot: bigint): number {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const count = Number(view.getBigUint64(0, true));
	const at = (i: number) => view.getBigUint64(8 + i * 40, true);
	if (count === 0) return -1;
	if (slot > at(0)) return 0;
	let lo = 0;
	let hi = count;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const s = at(mid);
		if (s === slot) return mid;
		if (s > slot) lo = mid + 1;
		else hi = mid;
	}
	return -1;
}

/**
 * How long a transfer tap signed over `slotNumber`'s hash stays usable.
 *
 * `set_linked_wallet` looks the slot up in SlotHashes at execution time. An
 * entry at index `i` survives `511 − i` more blocks before eviction, so the
 * window is counted in real SlotHashes positions (skipped slots don't consume
 * entries) at {@link MS_PER_SLOT} per slot.
 */
export async function tapWindow(rpc: Rpc<SolanaRpcApi>, slotNumber: bigint, now = Date.now()): Promise<TapWindow> {
	const index = slotHashIndex(await slotHashes(rpc, now), slotNumber);
	const totalSlots = SLOT_HASHES_MAX_ENTRIES - 1 - LANDING_MARGIN_SLOTS;
	const remainingSlots = index < 0 ? 0 : Math.max(0, SLOT_HASHES_MAX_ENTRIES - 1 - index - LANDING_MARGIN_SLOTS);
	return {
		alive: remainingSlots > 0,
		remainingSlots,
		expiresAt: now + remainingSlots * MS_PER_SLOT,
		totalMs: totalSlots * MS_PER_SLOT
	};
}
