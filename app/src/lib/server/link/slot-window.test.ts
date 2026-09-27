import { describe, expect, it } from 'vitest';
import type { Rpc, SolanaRpcApi } from '@solana/kit';

import { bytesToBase64 } from '$lib/shared/encoding';
import { LANDING_MARGIN_SLOTS, MS_PER_SLOT, SLOT_HASHES_MAX_ENTRIES, slotHashIndex, tapWindow } from './slot-window';

/** SlotHashes layout: u64 count, then (u64 slot, [u8; 32] hash) newest first. */
function sysvar(slots: bigint[]): Uint8Array {
	const data = new Uint8Array(8 + slots.length * 40);
	const view = new DataView(data.buffer);
	view.setBigUint64(0, BigInt(slots.length), true);
	slots.forEach((s, i) => view.setBigUint64(8 + i * 40, s, true));
	return data;
}

/** Newest-first entries with every 4th slot skipped (no block → no entry). */
function entries(newest: bigint, count: number): bigint[] {
	const out: bigint[] = [];
	for (let s = newest; out.length < count; s--) if (s % 4n !== 0n) out.push(s);
	return out;
}

function fakeRpc(data: Uint8Array) {
	return {
		getAccountInfo: () => ({ send: async () => ({ value: { data: [bytesToBase64(data), 'base64'] } }) })
	} as unknown as Rpc<SolanaRpcApi>;
}

describe('slotHashIndex', () => {
	const list = entries(10_000n, SLOT_HASHES_MAX_ENTRIES);
	const data = sysvar(list);

	it('finds entries by position, not by slot distance (skipped slots have no entry)', () => {
		expect(slotHashIndex(data, list[0])).toBe(0);
		expect(slotHashIndex(data, list[300])).toBe(300);
		expect(slotHashIndex(data, list[511])).toBe(511);
	});

	it('returns -1 once evicted or for a skipped slot, and 0 for a slot newer than the RPC view', () => {
		expect(slotHashIndex(data, list[511] - 50n)).toBe(-1);
		expect(slotHashIndex(data, 9_996n)).toBe(-1); // skipped
		expect(slotHashIndex(data, 10_005n)).toBe(0);
	});
});

describe('tapWindow', () => {
	it('counts the blocks the entry can still survive, minus the landing margin, at 200 ms per slot', async () => {
		const list = entries(50_000n, SLOT_HASHES_MAX_ENTRIES);
		const now = 1_000_000;
		const w = await tapWindow(fakeRpc(sysvar(list)), list[100], now + 10_000);
		const remaining = SLOT_HASHES_MAX_ENTRIES - 1 - 100 - LANDING_MARGIN_SLOTS;
		expect(MS_PER_SLOT).toBe(200);
		expect(w).toMatchObject({ alive: true, remainingSlots: remaining });
		expect(w.expiresAt).toBe(now + 10_000 + remaining * 200);
		expect(w.totalMs).toBe((SLOT_HASHES_MAX_ENTRIES - 1 - LANDING_MARGIN_SLOTS) * 200);
	});

	it('is over inside the landing margin and after eviction', async () => {
		const list = entries(90_000n, SLOT_HASHES_MAX_ENTRIES);
		const late = await tapWindow(fakeRpc(sysvar(list)), list[SLOT_HASHES_MAX_ENTRIES - LANDING_MARGIN_SLOTS], 5_000_000);
		expect(late.alive).toBe(false);
		const gone = await tapWindow(fakeRpc(sysvar(list)), list[511] - 100n, 6_000_000);
		expect(gone).toMatchObject({ alive: false, remainingSlots: 0 });
	});
});
