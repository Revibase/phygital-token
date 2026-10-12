import type { AccessoryView } from '$lib/shared/types';

/** Link policy is independent of physical tradability. `owned` means the owner is connected. */
export type TapScreen = {
	title: string;
	body: string;
	walletLabel: string | null;
	footnote?: string;
	claim: boolean;
	move: boolean;
};

/** Display choices only; every ownership change still requires on-chain authorization. */
export function managementActions(a: AccessoryView, owned: boolean) {
	const valid = a.status !== 'unavailable' && a.kind !== 'unknown';
	const release = valid && owned && !!a.owner && a.canRelease;
	const changeOwner = release && a.kind === 'bearer' && a.canLink;
	const connectOwner = valid && !!a.owner && !owned && a.canRelease;
	const wallet = valid;
	return { release, changeOwner, connectOwner, wallet, hasActions: release || changeOwner || connectOwner || wallet };
}

export function tapScreen(a: AccessoryView, owned: boolean): TapScreen {
	const none = { walletLabel: null, claim: false, move: false };
	if (a.status === 'unavailable') {
		return { ...none, title: 'Unavailable', body: 'This accessory’s record is in an unexpected state. Contact the issuer.' };
	}

	if (!a.owner) {
		return { ...none, claim: a.canLink, title: 'Ready to claim', body: '' };
	}

	const walletLabel = 'Owner';

	if (a.kind === 'bearer') {
		if (owned) {
			return {
				walletLabel,
				claim: false,
				move: a.canLink,
				title: 'Claimed',
				// Locked when the issuer linked it at setup: nobody can claim it until it's released.
				body: ''
			};
		}
		return {
			walletLabel,
			claim: a.canLink,
			move: false,
			title: 'Claimed',
			body: ''
		};
	}

	if (a.kind === 'permanent') {
		return owned
			? { walletLabel, claim: false, move: false, title: 'Permanently assigned', body: '' }
			: { walletLabel, claim: false, move: false, title: 'Permanently assigned', body: '' };
	}

	return owned
		? { walletLabel, claim: false, move: false, title: 'Claimed', body: '' }
		: { walletLabel, claim: false, move: false, title: 'Claimed', body: '' };
}

/** Shown when this device linked the accessory before and it now points elsewhere. */
export function changedElsewhereNotice(a: AccessoryView): { title: string; body: string } {
	return a.kind === 'bearer'
		? { title: 'Owner changed', body: 'Since you last used it here, another wallet became the owner. You can claim it while it is unlocked.' }
		: {
				title: 'Owner changed',
				// Controlled only moves after the owner releases it, so it can't simply be linked back.
				body: 'Since you last used it here, it was released and claimed with another wallet. Only that wallet can release it now.'
			};
}
