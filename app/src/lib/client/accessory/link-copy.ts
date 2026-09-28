import type { TokenKind } from '$lib/shared/types';

/**
 * Wording for the link ceremony, by token type (see `tapScreen`):
 *
 * - Bearer:     claiming a tradable collectible. It's yours until someone else
 *               claims it. Never framed as a sign-in key.
 * - Controlled: linking a personal key. It signs in as the wallet and stays
 *               locked to it until released.
 *
 * Permanent accessories never reach this flow. An unknown type (nothing attached
 * yet, or a row from before types were recorded) gets the key wording: it's the
 * one that carries the warning.
 */
export type LinkCopy = {
	/** Document title for the flow. */
	pageTitle: string;
	/** Picking a wallet, before one is connected. */
	choose: { title: string; body: string };
	/** A wallet is connected and about to sign. */
	confirm: { title: string; body: string };
	/** The signing button. */
	action: string;
	/** Computer: does the phone show the same code? */
	checkAccessory: string;
	/** Waiting on a wallet elsewhere: in a wallet app, or on a computer. */
	finishInWallet: string;
	finishOnComputer: string;
	/** In-flight, once the recipient is known. */
	progress: (wallet: string) => string;
	cancelled: string;
	stopped: string;
	/** Success. `wallet` is the recipient's short address; `yours` when this device's wallet signed. */
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
	choose: { title: 'Choose a wallet', body: 'It will sign in as the wallet you pick.' },
	confirm: {
		title: 'Link this wallet?',
		body: 'Anyone holding it can sign in as this wallet, and it stays locked to it until you release it. Only continue if it’s yours.'
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
			yours ? 'It now signs in as your wallet, and stays locked to it until you release it.' : `It now signs in as ${wallet}.`
	}
};

export function linkCopy(kind: TokenKind | null | undefined): LinkCopy {
	return kind === 'bearer' ? COLLECTIBLE : KEY;
}
