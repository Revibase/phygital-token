import type { AccessoryView } from '#lib/shared/types.ts';

/** Link policy is independent of physical tradability. `owned` means the owner is connected. */
export type TapScreen = {
	title: string;
	body: string;
	claim: boolean;
};

/** Display choices only. Release still requires the owner wallet's signature. */
export function managementActions(a: AccessoryView, owned: boolean) {
	const valid = a.status !== 'unavailable' && a.kind !== 'unknown';
	const release = valid && !!a.owner && a.canRelease;
	const changeOwner = release && owned && a.kind === 'bearer' && a.canLink;
	return { release, changeOwner, hasActions: release || changeOwner };
}

export function tapScreen(a: AccessoryView, owned: boolean): TapScreen {
	if (a.status === 'unavailable') {
		return {
			title: 'Unavailable',
			body: 'This accessory’s record is in an unexpected state. Contact the issuer.',
			claim: false
		};
	}

	if (!a.owner) return { claim: a.canLink, title: 'Ready to claim', body: '' };
	if (a.kind === 'permanent') return { claim: false, title: 'Permanently assigned', body: '' };
	return {
		claim: a.kind === 'bearer' && !owned && a.canLink,
		title: 'Claimed',
		body: ''
	};
}
