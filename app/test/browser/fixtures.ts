import { resolveShortcuts } from '../../src/lib/shared/shortcuts.ts';
import type { AccessoryView } from '../../src/lib/shared/types.ts';
export const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
export const MINT = 'So11111111111111111111111111111111111111112';
export const accessory: AccessoryView = {
	pda: MINT,
	tag: 'TEST',
	publicKey: 'simulation',
	kind: 'bearer',
	status: 'linked',
	owner: OWNER,
	isLocked: false,
	mint: MINT,
	canLink: true,
	canRelease: true
};
export const project = {
	externalUrl: 'https://project.example',
	shortcuts: resolveShortcuts(
		{
			shortcuts: [
				{
					label: 'Play',
					uri: 'https://project.example/play',
					icon: 'gaming'
				},
				{
					label: 'Stake NFT',
					uri: 'https://staking.project.example/stake',
					icon: 'stake'
				},
				{
					label: 'Visit website',
					uri: 'https://project.example/about',
					icon: 'view',
					prefersExternalTarget: true
				}
			]
		},
		{
			externalUrl: 'https://project.example',
			tokenId: MINT,
			collectionId: null,
			ownerAddress: OWNER
		}
	)
};
