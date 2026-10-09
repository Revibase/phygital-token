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
	checkAccessory: string;
	finishInWallet: string;
	finishOnComputer: string;
	progress: (wallet: string) => string;
	cancelled: string;
	stopped: string;
	done: { title: string; body: (yours: boolean, wallet: string) => string };
};


const COMMON: LinkCopy = {
	pageTitle: 'Link a wallet',
	choose: { title: 'Choose a wallet', body: 'Link the accessory to the wallet you pick.' },
	confirm: { title: 'Link this wallet?', body: '' },
	action: 'Link wallet',
	checkAccessory: 'Is this the right accessory?',
	finishInWallet: 'Approve the link there, then come back.',
	finishOnComputer: 'Approve the link in your wallet there.',
	progress: (wallet) => `Linking to ${wallet}…`,
	cancelled: 'Linking cancelled',
	stopped: 'Linking stopped',
	done: { title: 'Wallet linked', body: (yours, wallet) => yours ? 'Linked to your wallet.' : `Linked to ${wallet}.` }
};

const BEARER: LinkCopy = {
	...COMMON,
	confirm: { title: 'Link this wallet?', body: 'Anyone holding the accessory can use its tap access and relink it while unlocked.' }
};
const CONTROLLED: LinkCopy = {
	...COMMON,
	confirm: { title: 'Link this wallet?', body: 'Anyone holding the accessory can use its tap access. Only the owner can unlink it before another wallet links it.' },
	done: {
		title: 'Wallet linked',
		body: (yours, wallet) => yours ? 'Linked to your wallet until you unlink it.' : `Linked to ${wallet} until that wallet unlinks it.`
	}
};

export function linkCopy(kind: TokenKind | null | undefined): LinkCopy {
	return kind === 'bearer' ? BEARER : CONTROLLED;
}
