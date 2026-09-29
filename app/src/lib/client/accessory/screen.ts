import type { AccessoryView } from '$lib/shared/types';

/**
 * What the tap screen (`/accessory`) says and offers, by token type:
 *
 * - Bearer:     a tradable collectible. Whoever holds it can claim it, so
 *               "Make it yours" is the main action for anyone but its owner.
 *               Its tap still authenticates the object (proves it's real and
 *               here now), but never stands in for a wallet.
 * - Controlled: a personal key. Claimed once, then locked to its owner until
 *               they release it.
 * - Permanent:  a personal key bound to one wallet forever.
 *
 * `owned` is true only when the linked wallet is connected in this browser.
 */
export type TapScreen = {
	title: string;
	body: string;
	walletLabel: string | null;
	footnote?: string;
	claim: boolean;
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
			: { ...none, claim: true, title: 'Ready for its owner', body: `${TWO_STEPS} It stays locked to your wallet until you unlink it.` };
	}

	// A Bearer is a collectible, so its wallet "owns" it; a key is only linked to one.
	const walletLabel = owned ? 'Your wallet' : a.kind === 'bearer' ? 'Owned by' : 'Linked wallet';

	if (a.kind === 'bearer') {
		if (owned) {
			return {
				walletLabel,
				claim: false,
				move: a.canLink,
				title: 'In your collection',
				// Locked when the issuer linked it at setup: nobody can claim it until it's released.
				body: a.canLink ? 'Whoever holds it can claim it.' : 'No one else can claim it until you unlink it.'
			};
		}
		return {
			walletLabel,
			claim: a.canLink,
			move: false,
			title: 'In someone’s collection',
			body: a.canLink ? `Traded for it? ${TWO_STEPS}` : 'It can change hands once its owner unlinks it.'
		};
	}

	if (a.kind === 'permanent') {
		return owned
			? { walletLabel, claim: false, move: false, title: 'Yours for good', body: 'A tap always proves you’re this wallet.', footnote: 'This can’t be changed.' }
			: { walletLabel, claim: false, move: false, title: 'Bound to a wallet', body: 'A tap always proves it’s the wallet below.', footnote: 'This can’t be changed.' };
	}

	// Controlled
	return owned
		? { walletLabel, claim: false, move: false, title: 'Yours', body: 'Tap it to prove you’re this wallet.', footnote: 'Locked to your wallet until you unlink it.' }
		: { walletLabel, claim: false, move: false, title: 'Linked to a wallet', body: 'A tap proves it’s the wallet below.', footnote: 'It can’t change hands until the linked wallet unlinks it.' };
}

/** Shown when this device linked the accessory before and it now points elsewhere. */
export function changedElsewhereNotice(a: AccessoryView): { title: string; body: string } {
	return a.kind === 'bearer'
		? { title: 'Claimed by another wallet', body: 'Since you last used it here, a different wallet claimed it. If it’s still with you, make it yours again.' }
		: {
				title: 'Linked to a different wallet',
				// Controlled only moves after the linked wallet releases it, so it can't simply be linked back.
				body: 'Since you last used it here, it was unlinked and linked to another wallet. Only that wallet can unlink it now.'
			};
}
