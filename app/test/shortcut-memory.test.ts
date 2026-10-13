import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	rememberWallet,
	rememberedWallet,
	recentWallet,
	rememberRecentWallet
} from '$lib/client/memory';

describe('browser-local wallet memory', () => {
	let storage: Map<string, string>;
	beforeEach(() => {
		storage = new Map();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key)
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('remembers the linked owner per accessory', () => {
		rememberWallet('a', 'owner-a');
		rememberWallet('b', 'owner-b');
		expect(rememberedWallet('a')).toBe('owner-a');
		rememberWallet('a', null);
		expect(rememberedWallet('a')).toBeNull();
		expect(rememberedWallet('b')).toBe('owner-b');
	});

	it('remembers the most recent wallet app, ignoring empty names', () => {
		rememberRecentWallet('Phantom');
		rememberRecentWallet(null);
		expect(recentWallet()).toBe('Phantom');
	});

	it('survives storage that throws', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		});
		expect(() => rememberWallet('a', 'x')).not.toThrow();
		expect(rememberedWallet('a')).toBeNull();
		expect(recentWallet()).toBeNull();
	});
});
