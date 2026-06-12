import { browser } from '$app/environment';

export type SavedCollection = {
	id: string;
	name: string;
	symbol: string;
	groupMint: string;
	metadataUri?: string;
	createdAt: number;
};

const STORAGE_KEY = 'phygital-nfts:collections';

function readCollections(): SavedCollection[] {
	if (!browser) {
		return [];
	}

	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return [];
		}

		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter(isSavedCollection);
	} catch {
		return [];
	}
}

function writeCollections(collections: SavedCollection[]): void {
	if (!browser) {
		return;
	}

	localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
}

function isSavedCollection(value: unknown): value is SavedCollection {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const record = value as Record<string, unknown>;
	return (
		typeof record.id === 'string' &&
		typeof record.name === 'string' &&
		typeof record.symbol === 'string' &&
		typeof record.groupMint === 'string' &&
		typeof record.createdAt === 'number'
	);
}

export function loadCollections(): SavedCollection[] {
	return readCollections().sort((left, right) => right.createdAt - left.createdAt);
}

export function getCollectionById(id: string): SavedCollection | null {
	return loadCollections().find((collection) => collection.id === id) ?? null;
}

export function saveCollection(collection: SavedCollection): SavedCollection[] {
	const collections = readCollections();
	const next = [collection, ...collections.filter((entry) => entry.id !== collection.id)];
	writeCollections(next);
	return next;
}

export function removeCollection(id: string): SavedCollection[] {
	const next = readCollections().filter((collection) => collection.id !== id);
	writeCollections(next);
	return next;
}
