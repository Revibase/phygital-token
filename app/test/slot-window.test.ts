import { expect, it } from 'vitest';

import { TAP_WINDOW_MS } from '$lib/server/link/slot-window';

it('counts the SlotHashes entries left after the landing margin, at 200 ms a slot', () => {
	expect(TAP_WINDOW_MS).toBe(491 * 200);
});
