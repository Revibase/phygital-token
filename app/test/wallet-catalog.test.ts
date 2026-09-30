import { describe, expect, it } from 'vitest';

import { walletChoices } from '$lib/client/wallet/catalog';
import type { WalletOption } from '$lib/client/wallet/wallet.svelte';

const ORIGIN = 'https://accessory.test';
const TARGET = `${ORIGIN}/continue#h=abc`;
const opt = (name: string): WalletOption => ({ id: name.toLowerCase(), name, icon: '', ready: true });

describe('walletChoices', () => {
	it('lists detected wallets first, known ones first, then the featured wallets that weren’t detected', () => {
		const choices = walletChoices([opt('Glow'), opt('Solflare')], { browseTarget: TARGET, platform: 'ios', origin: ORIGIN });
		expect(choices.map((c) => `${c.kind}:${c.name}`)).toEqual(['detected:Solflare', 'detected:Glow', 'browse:Phantom', 'browse:Backpack']);
	});

	it('builds each wallet’s documented browse deep link with an encoded target and ref', () => {
		const hrefs = walletChoices([], { browseTarget: TARGET, platform: 'android', origin: ORIGIN }).map((c) => c.kind === 'browse' && c.href);
		const t = encodeURIComponent(TARGET);
		const r = encodeURIComponent(ORIGIN);
		expect(hrefs).toEqual([
			`https://phantom.app/ul/browse/${t}?ref=${r}`,
			`https://backpack.app/ul/v1/browse/${t}?ref=${r}`,
			`https://solflare.com/ul/v1/browse/${t}?ref=${r}`
		]);
	});

	it('never lists a featured wallet twice when it’s already detected', () => {
		const choices = walletChoices([opt('Phantom'), opt('Backpack'), opt('Solflare')], { browseTarget: TARGET, platform: 'android', origin: ORIGIN });
		expect(choices.map((c) => `${c.kind}:${c.name}`)).toEqual(['detected:Phantom', 'detected:Backpack', 'detected:Solflare']);
		// Detected names vary ("Phantom Wallet"); matching is by the same pattern as the icons.
		const renamed = walletChoices([opt('Phantom Wallet')], { browseTarget: TARGET, platform: 'ios', origin: ORIGIN });
		expect(renamed.map((c) => `${c.kind}:${c.name}`)).toEqual(['detected:Phantom Wallet', 'browse:Backpack', 'browse:Solflare']);
	});

	it('offers no deep links on desktop, without a target, or for a foreign target', () => {
		expect(walletChoices([opt('Glow')], { browseTarget: TARGET, platform: 'desktop', origin: ORIGIN }).map((c) => c.kind)).toEqual(['detected']);
		expect(walletChoices([], { browseTarget: TARGET, platform: 'desktop', origin: ORIGIN })).toEqual([]);
		expect(walletChoices([], { browseTarget: null, platform: 'ios', origin: ORIGIN })).toEqual([]);
		expect(walletChoices([], { browseTarget: 'https://evil.example/continue', platform: 'ios', origin: ORIGIN })).toEqual([]);
		expect(walletChoices([], { browseTarget: `${ORIGIN}.evil.example/x`, platform: 'ios', origin: ORIGIN })).toEqual([]);
	});

	it('puts the recently used wallet first and marks it, detected or not', () => {
		const detected = walletChoices([opt('Phantom'), opt('Solflare')], { browseTarget: null, platform: 'ios', origin: ORIGIN, recent: 'solflare' });
		expect(detected.map((c) => [c.name, c.recent])).toEqual([['Solflare', true], ['Phantom', false]]);

		const browse = walletChoices([], { browseTarget: TARGET, platform: 'ios', origin: ORIGIN, recent: 'Backpack' });
		expect(browse.map((c) => c.name)).toEqual(['Backpack', 'Phantom', 'Solflare']);
		expect(browse[0].recent).toBe(true);
	});
});
