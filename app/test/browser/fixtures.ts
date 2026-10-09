import { resolveShortcuts } from '../../src/lib/shared/shortcuts.ts';
import type { AccessoryView } from '../../src/lib/shared/types.ts';
export const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
export const MINT = 'So11111111111111111111111111111111111111112';
export const accessory: AccessoryView = {
	pda: MINT,
	identifier: 'simulation',
	tag: 'TEST',
	publicKey: 'simulation',
	kind: 'bearer',
	status: 'linked',
	owner: OWNER,
	isLocked: false,
	mint: MINT,
	lastSignCount: 1,
	canLink: true,
	canRelease: true
};
export const project = {
	externalUrl: 'https://project.example',
	shortcuts: resolveShortcuts(
		{
			shortcuts: [
				{ label: 'Play', uri: 'https://project.example/play', icon: 'gaming', revibase: { launch: 'embed' } },
				{ label: 'Stake NFT', uri: 'https://staking.example/stake', icon: 'stake', revibase: { launch: 'wallet' } },
				{ label: 'Visit website', uri: 'https://project.example/about', icon: 'view', revibase: { launch: 'browser' } }
			]
		},
		{ externalUrl: 'https://project.example', tokenId: MINT, collectionId: null, ownerAddress: OWNER }
	)
};
export const seed = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
