import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStoredOwners } from '#lib/client/memory.ts';

describe('browser-local wallet memory', () => {
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

	it('clears the owners older versions stored, and nothing else', () => {
		storage.set('revibase:linked:card-a', 'owner-a');
		storage.set('revibase:link-context:card-a', '{"wallet":"owner-a","app":"Phantom"}');
		storage.set('revibase:linked:card-b', 'owner-b');
		storage.set('unrelated', 'keep');
		clearStoredOwners();
		expect([...storage.keys()]).toEqual(['unrelated']);
	});

	it('tolerates blocked storage', () => {
		vi.stubGlobal('localStorage', {
			get length(): number {
				throw Error('blocked');
			},
			key() {
				throw Error('blocked');
			},
			removeItem() {
				throw Error('blocked');
			}
		});
		expect(() => clearStoredOwners()).not.toThrow();
	});
});
