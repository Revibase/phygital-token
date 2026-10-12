import type { TokenKind } from '$lib/shared/types';

/**
 * Explain the wallet-link rules without implying physical ownership.
 * Permanent accessories cannot enter this flow; unknown types use the stricter warning.
 */
export type LinkCopy = {
	pageTitle: string;
	choose: { title: string; body: string };
	confirm: { title: string; body: string };
	action: string;
	done: { title: string; body: (yours: boolean, wallet: string) => string };
};

const COMMON: LinkCopy = {
	pageTitle: 'Claim accessory',
	choose: { title: 'Choose a wallet', body: 'Choose a wallet to become the owner. You’ll use it to approve changes and sends.' },
	confirm: { title: 'Claim with this wallet?', body: '' },
	action: 'Claim accessory',
	done: { title: 'Accessory claimed', body: (yours, wallet) => yours ? 'You’re now the owner of this accessory.' : `Managed by ${wallet}.` }
};

const BEARER: LinkCopy = {
	...COMMON,
	confirm: { title: 'Claim with this wallet?', body: 'Anyone holding the accessory can sign in with a tap and claim it while unlocked. Assets stay in the accessory wallet; the new owner gains control of them. Claiming does not transfer its bound NFT.' }
};
const CONTROLLED: LinkCopy = {
	...COMMON,
	confirm: { title: 'Claim with this wallet?', body: 'Anyone holding the accessory can use its tap access. Only the owner can release it before another wallet claims it. Claiming does not transfer its bound NFT.' },
	done: {
		title: 'Accessory claimed',
		body: (yours, wallet) => yours ? 'You’re the owner until you release this accessory.' : `Managed by ${wallet} until the owner releases it.`
	}
};

export function linkCopy(kind: TokenKind | null | undefined): LinkCopy {
	return kind === 'bearer' ? BEARER : CONTROLLED;
}
