import { describe, expect, it } from 'vitest';
import { resolveShortcuts } from '$lib/shared/shortcuts';
import { shortcutLaunch } from '$lib/client/shortcuts';

const APP = 'https://provider.test/app';
const context = {
	externalUrl: 'https://project.test',
	tokenId: 'So11111111111111111111111111111111111111112',
	collectionId: null,
	ownerAddress: null
};
const shortcut = (mode: string) =>
	resolveShortcuts(
		{ shortcuts: [{ label: 'App', uri: APP, revibase: { launch: mode } }] },
		context
	)[0];

describe('shortcut launch', () => {
	it('opens embed and a legacy wallet value in the iframe', () => {
		expect(shortcutLaunch(shortcut('embed'))).toEqual({ kind: 'embed', href: APP });
		expect(shortcutLaunch(shortcut('wallet'))).toEqual({ kind: 'embed', href: APP });
	});

	it('opens a browser launch in a new tab', () => {
		expect(shortcutLaunch(shortcut('browser'))).toEqual({
			kind: 'link',
			href: APP,
			newTab: true
		});
	});
});
