import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	forgetOwnerDetails,
	rememberWallet,
	rememberedWallet,
	reconcileAccessoryWallet,
	rememberAccessoryLink,
	accessoryLinkContext,
	recentWallet,
	rememberRecentWallet
} from '$lib/client/memory';

const claimed = (
	wallet: string,
	app: string,
	source: 'desktop' | 'mobile' | 'wallet' = 'desktop'
) => ({ wallet, app, source }) as const;

describe('browser-local wallet preferences', () => {
	let storage: Map<string, string>;
	beforeEach(() => {
		storage = new Map();
		vi.stubGlobal('localStorage', {
			get length() {
				return storage.size;
			},
			key: (i: number) => [...storage.keys()][i] ?? null,
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key)
		});
	});
	afterEach(() => vi.unstubAllGlobals());
	it('forgets one accessory without clearing its linked address or another accessory', () => {
		rememberWallet('a', 'owner-a');
		rememberWallet('b', 'owner-b');
		rememberAccessoryLink('a', claimed('owner-a', 'Phantom'));
		rememberAccessoryLink('b', claimed('owner-b', 'Backpack'));
		rememberRecentWallet('Phantom');
		storage.set('unrelated', 'keep');
		forgetOwnerDetails('a');
		expect(accessoryLinkContext('a', 'owner-a')).toBeNull();
		expect(accessoryLinkContext('b', 'owner-b')?.app).toBe('Backpack');
		expect(recentWallet()).toBe('Phantom');
		expect(rememberedWallet('a')).toBe('owner-a');
		expect(rememberedWallet('b')).toBe('owner-b');
		expect(storage.get('unrelated')).toBe('keep');
	});
	it('deletes every stale accessory hint after another browser changes linkage', () => {
		rememberWallet('card-a', 'old-owner');
		rememberAccessoryLink('card-a', claimed('old-owner', 'Phantom', 'wallet'));
		rememberRecentWallet('Phantom');
		expect(reconcileAccessoryWallet('card-a', 'new-owner')).toBe(true);
		expect(rememberedWallet('card-a')).toBeNull();
		expect(accessoryLinkContext('card-a', 'old-owner')).toBeNull();
		expect(recentWallet()).toBeNull();
		rememberWallet('card-a', 'new-owner');
		rememberAccessoryLink('card-a', claimed('new-owner', 'Backpack', 'mobile'));
		expect(accessoryLinkContext('card-a', 'new-owner')?.app).toBe('Backpack');
	});
	it('clears a mismatched token record without clearing another accessory', () => {
		rememberAccessoryLink('card-b', claimed('owner-b', 'Backpack'));
		storage.set(
			'revibase:link-context:card-a',
			JSON.stringify({ pda: 'wrong-token', wallet: 'owner-a', app: 'Phantom', source: 'wallet' })
		);
		expect(reconcileAccessoryWallet('card-a', 'owner-a')).toBe(true);
		expect(accessoryLinkContext('card-b', 'owner-b')?.app).toBe('Backpack');
	});
	it('shows where this browser claimed the accessory', () => {
		rememberAccessoryLink('card-a', claimed('owner-a', 'Phantom'));
		expect(accessoryLinkContext('card-a', 'owner-a')).toEqual({
			wallet: 'owner-a',
			app: 'Phantom',
			source: 'desktop'
		});
		expect(accessoryLinkContext('card-a', 'owner-b')).toBeNull();
	});
	it('does not treat another browser as having a preference', () => {
		rememberRecentWallet('Phantom');
		expect(recentWallet()).toBe('Phantom');
		storage.clear();
		expect(recentWallet()).toBeNull();
		expect(accessoryLinkContext('card-a', 'owner-a')).toBeNull();
	});
	it('tolerates blocked storage and malformed preferences', () => {
		storage.set('revibase:link-context:card-a', 'bad json');
		expect(accessoryLinkContext('card-a', 'owner-a')).toBeNull();
		vi.stubGlobal('localStorage', {
			getItem() {
				throw Error('blocked');
			},
			setItem() {
				throw Error('blocked');
			}
		});
		expect(accessoryLinkContext('card-a', 'owner-a')).toBeNull();
		expect(() => rememberAccessoryLink('card-a', claimed('owner-a', 'Phantom'))).not.toThrow();
	});
});
