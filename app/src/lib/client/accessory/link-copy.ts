import type { TokenKind } from '#lib/shared/types.ts';

/**
 * Explain the wallet-link rules without implying physical ownership.
 * Permanent accessories cannot enter this flow; unknown types use the stricter warning.
 */
export type LinkCopy = {
	pageTitle: string;
	choose: { title: string; body: string };
	confirm: { title: string; body: string };
	/** Added to the confirm body when the accessory is bound to an NFT. */
	nft: string;
	action: string;
	done: { title: string; body: (yours: boolean, wallet: string) => string };
};

const COMMON: LinkCopy = {
	pageTitle: 'Claim accessory',
	choose: {
		title: 'Choose a wallet',
		body: 'This wallet will own the accessory.'
	},
	confirm: { title: 'Claim with this wallet?', body: '' },
	nft: 'Its NFT stays where it is.',
	action: 'Claim accessory',
	done: {
		title: 'Accessory claimed',
		body: (yours, wallet) => (yours ? 'You’re now its owner.' : `Owned by ${wallet}.`)
	}
};

const BEARER: LinkCopy = {
	...COMMON,
	confirm: {
		title: 'Claim with this wallet?',
		body: 'Anyone holding this accessory can claim it while it’s unlocked.'
	}
};
const CONTROLLED: LinkCopy = {
	...COMMON,
	confirm: {
		title: 'Claim with this wallet?',
		body: 'Anyone holding this accessory can still tap it, but only the owner can release it to someone else.'
	},
	done: {
		title: 'Accessory claimed',
		body: (yours, wallet) =>
			yours ? 'You’re its owner until you release it.' : `Owned by ${wallet} until it’s released.`
	}
};

export function linkCopy(kind: TokenKind | null | undefined): LinkCopy {
	return kind === 'bearer' ? BEARER : CONTROLLED;
}
