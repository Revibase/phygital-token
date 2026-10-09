import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetOwnerDetails, shouldChooseWallet, rememberWallet, rememberedWallet, reconcileAccessoryWallet, rememberAccessoryLink, accessoryLinkContext, accessoryConnectionMethod, recentConnectionMethod, accessoryWalletApp, rememberAccessoryWalletApp, recentWallet, rememberRecentWallet } from '$lib/client/memory';

describe('browser-local wallet preferences', () => {
	let storage: Map<string, string>;
	beforeEach(() => {
		storage = new Map();
		vi.stubGlobal('localStorage', {
			get length() { return storage.size; },
			key: (i: number) => [...storage.keys()][i] ?? null,
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key)
		});
	});
	afterEach(() => vi.unstubAllGlobals());
	it('forgets only one accessory and restores its routing after a new choice', () => {
		vi.stubGlobal('window', { dispatchEvent: vi.fn() });
		rememberWallet('a','owner-a');
		rememberWallet('b','owner-b');
		rememberAccessoryLink('a',{wallet:'owner-a',app:'Phantom',source:'desktop'});
		rememberAccessoryWalletApp('b','owner-b','Backpack');
		rememberRecentWallet('Phantom');
		storage.set('unrelated','keep');
		forgetOwnerDetails('a');
		expect(accessoryLinkContext('a','owner-a')).toBeNull();
		expect(accessoryWalletApp('b','owner-b')).toBe('Backpack');
		expect(recentWallet()).toBe('Phantom');
		expect(rememberedWallet('a')).toBe('owner-a');
		expect(rememberedWallet('b')).toBe('owner-b');
		expect(storage.get('unrelated')).toBe('keep');
		expect(shouldChooseWallet('a')).toBe(true);
		rememberRecentWallet('Solflare');
		expect(shouldChooseWallet('a')).toBe(true);
		expect(shouldChooseWallet('b')).toBe(false);
		rememberAccessoryWalletApp('a','owner-a','Solflare');
		expect(shouldChooseWallet('a')).toBe(false);
	});
	it('deletes every stale accessory hint after another browser changes linkage', () => {
		rememberWallet('card-a','old-owner');
		rememberAccessoryLink('card-a',{wallet:'old-owner',app:'Phantom',source:'wallet'});
		rememberAccessoryWalletApp('card-a','old-owner','Phantom');
		rememberRecentWallet('Phantom');
		expect(reconcileAccessoryWallet('card-a','new-owner')).toBe(true);
		expect(rememberedWallet('card-a')).toBeNull();
		expect(accessoryLinkContext('card-a','old-owner')).toBeNull();
		expect(recentWallet()).toBeNull();
		rememberWallet('card-a','new-owner');
		rememberAccessoryLink('card-a',{wallet:'new-owner',app:'Backpack',source:'mobile'});
		expect(accessoryLinkContext('card-a','new-owner')?.app).toBe('Backpack');
	});
	it('clears unlinked and mismatched token records without clearing another accessory', () => {
		rememberAccessoryWalletApp('card-a','owner-a','Phantom');
		rememberAccessoryWalletApp('card-b','owner-b','Backpack');
		expect(reconcileAccessoryWallet('card-a',null)).toBe(true);
		expect(accessoryWalletApp('card-b','owner-b')).toBe('Backpack');
		storage.set('revibase:link-context:card-b',JSON.stringify({pda:'wrong-token',wallet:'owner-b',app:'Backpack',source:'wallet'}));
		expect(reconcileAccessoryWallet('card-b','owner-b')).toBe(true);
	});
	it('keeps actual linking context independent from shortcut preferences', () => {
		rememberAccessoryLink('card-a', {wallet:'owner-a',app:'Phantom',source:'desktop'});
		rememberAccessoryWalletApp('card-a','owner-a','Solflare','wallet');
		expect(accessoryLinkContext('card-a','owner-a')).toEqual({wallet:'owner-a',app:'Phantom',source:'desktop'});
		expect(accessoryLinkContext('card-a','owner-b')).toBeNull();
	});
	it('distinguishes detected connectors from hardcoded browse choices with the same name', () => {
		rememberRecentWallet('Phantom', 'browser');
		rememberAccessoryWalletApp('card-a', 'owner-a', 'Phantom', 'browser');
		expect(recentConnectionMethod()).toBe('browser');
		expect(accessoryConnectionMethod('card-a', 'owner-a')).toBe('browser');
		rememberAccessoryWalletApp('card-a', 'owner-a', 'Phantom', 'wallet');
		expect(accessoryConnectionMethod('card-a', 'owner-a')).toBe('wallet');
		expect(accessoryConnectionMethod('card-a', 'new-owner')).toBeNull();
	});
	it('migrates legacy app preferences and isolates new devices', () => {
		storage.set('revibase:wallet-app:card-a', JSON.stringify({wallet: 'owner-a', app: 'Phantom'}));
		expect(accessoryConnectionMethod('card-a', 'owner-a')).toBe('wallet');
		storage.clear();
		expect(recentConnectionMethod()).toBeNull();
	});
	it('keeps accessory choices separate and invalidates them after linkage changes', () => {
		rememberAccessoryWalletApp('card-a', 'owner-a', 'Phantom');
		rememberAccessoryWalletApp('card-b', 'owner-b', 'Backpack');
		expect(accessoryWalletApp('card-a', 'owner-a')).toBe('Phantom');
		expect(accessoryWalletApp('card-b', 'owner-b')).toBe('Backpack');
		expect(accessoryWalletApp('card-a', 'new-owner')).toBeNull();
		expect(accessoryWalletApp('card-a', 'owner-a')).toBeNull();
	});
	it('does not treat another browser as having a preference', () => {
		rememberRecentWallet('Phantom');
		expect(recentWallet()).toBe('Phantom');
		storage.clear();
		expect(recentWallet()).toBeNull();
		expect(accessoryWalletApp('card-a', 'owner-a')).toBeNull();
	});
	it('tolerates blocked storage and malformed preferences', () => {
		storage.set('revibase:wallet-app:card-a', 'bad json');
		expect(accessoryWalletApp('card-a', 'owner-a')).toBeNull();
		vi.stubGlobal('localStorage', {
			getItem() {
				throw Error('blocked');
			},
			setItem() {
				throw Error('blocked');
			}
		});
		expect(accessoryWalletApp('card-a', 'owner-a')).toBeNull();
		expect(() => rememberAccessoryWalletApp('card-a', 'owner-a', 'Phantom')).not.toThrow();
	});
});
