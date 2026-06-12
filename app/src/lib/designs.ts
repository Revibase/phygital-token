import { browser } from '$app/environment';

export type SavedDesign = {
	id: string;
	collectionId: string;
	name: string;
	symbol: string;
	groupMint: string;
	designId: string;
	designMint: string;
	metadataUri?: string;
	signature?: string;
	createdAt: number;
};

const STORAGE_KEY = 'phygital-nfts:designs';

function readDesigns(): SavedDesign[] {
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

		return parsed.filter(isSavedDesign);
	} catch {
		return [];
	}
}

function writeDesigns(designs: SavedDesign[]): void {
	if (!browser) {
		return;
	}

	localStorage.setItem(STORAGE_KEY, JSON.stringify(designs));
}

function isSavedDesign(value: unknown): value is SavedDesign {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const record = value as Record<string, unknown>;
	return (
		typeof record.id === 'string' &&
		typeof record.collectionId === 'string' &&
		typeof record.name === 'string' &&
		typeof record.symbol === 'string' &&
		typeof record.groupMint === 'string' &&
		typeof record.designId === 'string' &&
		typeof record.designMint === 'string' &&
		typeof record.createdAt === 'number'
	);
}

export function loadDesigns(): SavedDesign[] {
	return readDesigns().sort((left, right) => right.createdAt - left.createdAt);
}

export function getDesignsForCollection(collectionId: string): SavedDesign[] {
	return loadDesigns().filter((design) => design.collectionId === collectionId);
}

export function getDesignById(id: string): SavedDesign | null {
	return loadDesigns().find((design) => design.id === id) ?? null;
}

export function saveDesign(design: SavedDesign): SavedDesign[] {
	const designs = readDesigns();
	const next = [design, ...designs.filter((entry) => entry.id !== design.id)];
	writeDesigns(next);
	return next;
}

export function removeDesign(id: string): SavedDesign[] {
	const next = readDesigns().filter((design) => design.id !== id);
	writeDesigns(next);
	return next;
}
