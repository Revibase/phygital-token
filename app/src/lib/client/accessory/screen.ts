import type { AccessoryView } from '#lib/shared/types.ts';

/** Link policy is independent of physical tradability. `owned` means the owner is connected. */
export type TapScreen = {
	title: string;
	body: string;
	claim: boolean;
};

/** Display choices only. Release is offered only when the connected wallet is the owner. */
export function managementActions(a: AccessoryView, owned: boolean) {
	const valid = a.status !== 'unavailable' && a.kind !== 'unknown';
	const release = valid && owned && a.canRelease;
	const changeOwner = release && a.kind === 'bearer' && a.canLink;
	return { release, changeOwner, hasActions: release || changeOwner };
}

export function tapScreen(a: AccessoryView, owned: boolean): TapScreen {
	if (a.status === 'unavailable') {
		return {
			title: 'Unavailable',
			body: 'Its record is in an unexpected state. Contact whoever issued it.',
			claim: false
		};
	}

	if (!a.owner) return { claim: a.canLink, title: 'Ready to claim', body: '' };
	if (owned) return { claim: false, title: 'Your accessory', body: '' };
	if (a.kind === 'permanent') return { claim: false, title: 'Permanently owned', body: '' };
	return { claim: a.kind === 'bearer' && a.canLink, title: 'Claimed', body: '' };
}
