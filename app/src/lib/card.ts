import type { CardAttribute } from 'phygital-nfts-client';

export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'unknown';

const RARITY_ALIASES: Record<string, RarityTier> = {
	common: 'common',
	uncommon: 'uncommon',
	rare: 'rare',
	epic: 'epic',
	legendary: 'legendary',
	mythic: 'legendary',
	ultra: 'legendary'
};

const SET_TRAIT_KEYS = new Set(['set', 'series']);
const NUMBER_TRAIT_KEYS = new Set(['number', 'card number', 'collector number']);
const KEY_STAT_TRAIT_KEYS = new Set(['hp', 'type']);

const GRID_HIDDEN_TRAIT_KEYS = new Set([
	'rarity',
	'set',
	'series',
	'number',
	'card number',
	'collector number',
	'hp',
	'type',
	'credentialid',
	'credential id',
	'expiry'
]);

function findAttribute(
	attributes: CardAttribute[],
	keys: Set<string>
): CardAttribute | null {
	return (
		attributes.find((attribute) => keys.has(attribute.traitType.toLowerCase())) ?? null
	);
}

export function getRarityAttribute(attributes: CardAttribute[]): CardAttribute | null {
	return findAttribute(attributes, new Set(['rarity']));
}

export function getSetAttribute(attributes: CardAttribute[]): CardAttribute | null {
	return findAttribute(attributes, SET_TRAIT_KEYS);
}

export function getCardNumberAttribute(attributes: CardAttribute[]): CardAttribute | null {
	return findAttribute(attributes, NUMBER_TRAIT_KEYS);
}

export function formatCardNumber(value: string): string {
	const match = value.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
	if (!match) {
		return value.trim();
	}
	const [, current, total] = match;
	return `${current.padStart(3, '0')}/${total}`;
}

export function getRarityTier(attributes: CardAttribute[]): RarityTier {
	const rarity = getRarityAttribute(attributes);
	if (!rarity) {
		return 'unknown';
	}
	return RARITY_ALIASES[rarity.value.toLowerCase()] ?? 'unknown';
}

export function hasHoloEffect(tier: RarityTier): boolean {
	return tier === 'rare' || tier === 'epic' || tier === 'legendary';
}

export function rarityAccentColor(tier: RarityTier): string {
	switch (tier) {
		case 'common':
			return '#94a3b8';
		case 'uncommon':
			return '#4ade80';
		case 'rare':
			return '#38bdf8';
		case 'epic':
			return '#a78bfa';
		case 'legendary':
			return '#fbbf24';
		default:
			return '#64748b';
	}
}

export function getKeyStats(attributes: CardAttribute[]): CardAttribute[] {
	return attributes.filter((attribute) =>
		KEY_STAT_TRAIT_KEYS.has(attribute.traitType.toLowerCase())
	);
}

export function gridAttributes(attributes: CardAttribute[]): CardAttribute[] {
	return attributes.filter(
		(attribute) => !GRID_HIDDEN_TRAIT_KEYS.has(attribute.traitType.toLowerCase())
	);
}

/** @deprecated Use gridAttributes */
export function displayAttributes(attributes: CardAttribute[]): CardAttribute[] {
	return gridAttributes(attributes);
}
