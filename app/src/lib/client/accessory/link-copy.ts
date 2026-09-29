import type { TokenKind } from '$lib/shared/types';

/**
 * Wording for the link ceremony, by token type (see `tapScreen`):
 *
 * - Bearer:     claiming a tradable collectible. It's yours until someone else
 *               claims it. Never framed as a wallet key.
 * - Controlled: linking a personal key. A tap proves you’re the wallet, and it stays
 *               locked to it until released.
 *
 * Permanent accessories never reach this flow. An unknown type (nothing attached
 * yet, or a row from before types were recorded) gets the key wording: it's the
 * one that carries the warning.
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

const COLLECTIBLE: LinkCopy = {
	pageTitle: 'Make it yours',
	choose: { title: 'Choose a wallet', body: 'It joins the collection of the wallet you pick.' },
	confirm: { title: 'Claim it with this wallet?', body: 'It’s yours until someone else claims it.' },
	action: 'Claim it',
	checkAccessory: 'Is this the right one?',
	finishInWallet: 'Approve the claim there, then come back.',
	finishOnComputer: 'Approve the claim in your wallet there.',
	progress: (wallet) => `Claiming for ${wallet}…`,
	cancelled: 'Claim cancelled',
	stopped: 'Claim stopped',
	done: {
		title: 'It’s in your collection',
		body: (yours, wallet) => (yours ? 'It’s yours until someone else claims it.' : `It’s now in ${wallet}’s collection.`)
	}
};

const KEY: LinkCopy = {
	pageTitle: 'Make it yours',
	choose: { title: 'Choose a wallet', body: 'A tap will prove you’re the wallet you pick.' },
	confirm: {
		title: 'Link this wallet?',
		body: 'Whoever holds it can prove they’re this wallet, and it stays locked to it until you unlink it. Only continue if it’s yours.'
	},
	action: 'Link wallet',
	checkAccessory: 'Is this your accessory?',
	finishInWallet: 'Approve the link there, then come back.',
	finishOnComputer: 'Approve the link in your wallet there.',
	progress: (wallet) => `Linking to ${wallet}…`,
	cancelled: 'Linking cancelled',
	stopped: 'Linking stopped',
	done: {
		title: 'It’s yours',
		body: (yours, wallet) =>
			yours ? 'A tap now proves you’re this wallet. It stays locked to it until you unlink it.' : `A tap now proves it’s ${wallet}.`
	}
};

export function linkCopy(kind: TokenKind | null | undefined): LinkCopy {
	return kind === 'bearer' ? COLLECTIBLE : KEY;
}
