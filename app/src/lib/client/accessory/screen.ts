import type { AccessoryView } from '$lib/shared/types';

/** Link policy is independent of physical tradability. `owned` means the linked wallet is connected. */
export type TapScreen = {
	title: string;
	body: string;
	walletLabel: string | null;
	footnote?: string;
	claim: boolean;
	move: boolean;
};

export function tapScreen(a: AccessoryView, owned: boolean): TapScreen {
	const none = { walletLabel: null, claim: false, move: false };
	if (a.status === 'unavailable') {
		return { ...none, title: 'Unavailable', body: 'This accessory’s record is in an unexpected state. Contact the issuer.' };
	}

	if (!a.linkedWallet) {
		return { ...none, claim: a.canLink, title: 'No wallet linked', body: '' };
	}

	const walletLabel = owned ? 'Your wallet' : 'Linked wallet';

	if (a.kind === 'bearer') {
		if (owned) {
			return {
				walletLabel,
				claim: false,
				move: a.canLink,
				title: 'Linked to your wallet',
				// Locked when the issuer linked it at setup: nobody can claim it until it's released.
				body: ''
			};
		}
		return {
			walletLabel,
			claim: a.canLink,
			move: false,
			title: 'Linked to a wallet',
			body: ''
		};
	}

	if (a.kind === 'permanent') {
		return owned
			? { walletLabel, claim: false, move: false, title: 'Permanently linked to your wallet', body: '' }
			: { walletLabel, claim: false, move: false, title: 'Permanently linked to a wallet', body: '' };
	}

	return owned
		? { walletLabel, claim: false, move: false, title: 'Linked to your wallet', body: '' }
		: { walletLabel, claim: false, move: false, title: 'Linked to a wallet', body: '' };
}

/** Shown when this device linked the accessory before and it now points elsewhere. */
export function changedElsewhereNotice(a: AccessoryView): { title: string; body: string } {
	return a.kind === 'bearer'
		? { title: 'Linked to a different wallet', body: 'Since you last used it here, another wallet was linked. You can relink it while it is unlocked.' }
		: {
				title: 'Linked to a different wallet',
				// Controlled only moves after the linked wallet releases it, so it can't simply be linked back.
				body: 'Since you last used it here, it was unlinked and linked to another wallet. Only that wallet can unlink it now.'
			};
}
