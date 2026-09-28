import type { AccessoryView } from '$lib/shared/types';

/**
 * What the tap screen (`/accessory`) says and offers, by token type:
 *
 * - Bearer:     a tradable collectible. Whoever holds it can claim it, so
 *               "Make it yours" is the main action for anyone but its owner.
 *               Never framed as a sign-in key.
 * - Controlled: a personal key. Claimed once, then locked to its owner until
 *               they release it.
 * - Permanent:  a personal key bound to one wallet forever.
 *
 * `owned` is true only when the linked wallet is connected in this browser.
 */
export type TapScreen = {
	title: string;
	body: string;
	/** Label for the linked wallet's row; null when nothing is linked. */
	walletLabel: string | null;
	footnote?: string;
	/** Prominent "Make it yours": a wallet can claim it from here. */
	claim: boolean;
	/** Owner-side row that moves the link to another of their wallets. */
	move: boolean;
};

/** Claiming is one tap of the accessory, then one approval in the wallet. */
const TWO_STEPS = 'Make it yours in two steps: tap it, then approve in your wallet.';

export function tapScreen(a: AccessoryView, owned: boolean): TapScreen {
	const none = { walletLabel: null, claim: false, move: false };
	if (a.status === 'unavailable') {
		return { ...none, title: 'Unavailable', body: 'This accessory’s record is in an unexpected state. Contact the issuer.' };
	}

	if (!a.linkedWallet) {
		return a.kind === 'bearer'
			? { ...none, claim: true, title: 'Unclaimed', body: `Whoever claims it owns it. ${TWO_STEPS}` }
			: { ...none, claim: true, title: 'Ready for its owner', body: `${TWO_STEPS} It stays locked to your wallet until you release it.` };
	}

	const walletLabel = owned ? 'Your wallet' : 'Owned by';

	if (a.kind === 'bearer') {
		if (owned) {
			return {
				walletLabel,
				claim: false,
				move: a.canLink,
				title: 'In your collection',
				// Locked when the issuer linked it at setup: nobody can claim it until it's released.
				body: a.canLink ? 'Whoever holds it can claim it.' : 'No one else can claim it until you release it.'
			};
		}
		return {
			walletLabel,
			claim: a.canLink,
			move: false,
			title: 'In someone’s collection',
			body: a.canLink ? `Traded for it? ${TWO_STEPS}` : 'It can change hands once its owner releases it.'
		};
	}

	if (a.kind === 'permanent') {
		return owned
			? { walletLabel, claim: false, move: false, title: 'Yours for good', body: 'It always signs in as your wallet.', footnote: 'This can’t be changed.' }
			: { walletLabel, claim: false, move: false, title: 'Bound to its owner', body: 'It always signs in as the wallet below.', footnote: 'This can’t be changed.' };
	}

	// Controlled
	return owned
		? { walletLabel, claim: false, move: false, title: 'Yours', body: 'It signs in as your wallet.', footnote: 'Locked to your wallet until you release it.' }
		: { walletLabel, claim: false, move: false, title: 'Owned', body: 'It signs in as the wallet below.', footnote: 'It can’t change hands until its owner releases it.' };
}

/** Shown when this device linked the accessory before and it now points elsewhere. */
export function changedElsewhereNotice(a: AccessoryView): { title: string; body: string } {
	return a.kind === 'bearer'
		? { title: 'Claimed by another wallet', body: 'Since you last used it here, a different wallet claimed it. If it’s still with you, make it yours again.' }
		: {
				title: 'Linked to a different wallet',
				// Controlled only moves after the linked wallet releases it, so it can't simply be linked back.
				body: 'Since you last used it here, it was released and linked to another wallet. Only that wallet can release it now.'
			};
}
