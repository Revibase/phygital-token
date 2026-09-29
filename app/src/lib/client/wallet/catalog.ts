import type { Platform } from '../capability';
import type { WalletOption } from './wallet.svelte';

/**
 * Wallets we always offer. When `@solana/connector` detects one (Wallet
 * Standard injection, extension, or MWA) we connect to it directly; when it
 * doesn't, on a phone we offer to open this page inside that wallet's in-app
 * browser instead. Any other wallet the connector detects is listed too.
 *
 * Browse deep links (URL-encoded target + URL-encoded `ref`):
 * - Phantom  https://docs.phantom.com/phantom-deeplinks/other-methods/browse
 * - Backpack https://docs.backpack.app/deeplinks/other-methods/browse
 * - Solflare https://docs.solflare.com/solflare/technical/deeplinks/other-methods/browse
 */
type KnownWallet = {
	id: 'phantom' | 'backpack' | 'solflare';
	name: string;
	/** Bundled icon in `static/wallets/`, so the row never depends on detection. */
	icon: string;
	match: RegExp;
	browse: (target: string, ref: string) => string;
};

const enc = encodeURIComponent;

export const KNOWN_WALLETS: readonly KnownWallet[] = [
	{ id: 'phantom', name: 'Phantom', icon: '/wallets/phantom.svg', match: /phantom/i, browse: (t, r) => `https://phantom.app/ul/browse/${enc(t)}?ref=${enc(r)}` },
	{ id: 'backpack', name: 'Backpack', icon: '/wallets/backpack.png', match: /backpack/i, browse: (t, r) => `https://backpack.app/ul/v1/browse/${enc(t)}?ref=${enc(r)}` },
	{ id: 'solflare', name: 'Solflare', icon: '/wallets/solflare.svg', match: /solflare/i, browse: (t, r) => `https://solflare.com/ul/v1/browse/${enc(t)}?ref=${enc(r)}` }
];

export const FEATURED_WALLET_NAMES = KNOWN_WALLETS.map((w) => w.name);

export type WalletChoice =
	| { kind: 'detected'; key: string; connectorId: string; name: string; icon: string; ready: boolean; recent: boolean }
	| { kind: 'browse'; key: string; name: string; icon: string; href: string; recent: boolean };

export function walletChoices(
	detected: WalletOption[],
	opts: { browseTarget: string | null; platform: Platform; origin: string; recent?: string | null }
): WalletChoice[] {
	const known = (name: string) => KNOWN_WALLETS.find((w) => w.match.test(name));
	const isRecent = (name: string) => !!opts.recent && name.toLowerCase() === opts.recent.toLowerCase();
	const rank = (name: string) => {
		const i = KNOWN_WALLETS.findIndex((w) => w.match.test(name));
		return i === -1 ? KNOWN_WALLETS.length : i;
	};
	const choices: WalletChoice[] = [...detected]
		.sort((a, b) => rank(a.name) - rank(b.name))
		.map((w) => ({ kind: 'detected', key: `detected:${w.id}`, connectorId: w.id, name: w.name, icon: w.icon || known(w.name)?.icon || '', ready: w.ready, recent: isRecent(w.name) }));
	// Recent first, otherwise the order above (sort is stable).
	const recentFirst = (list: WalletChoice[]) => list.sort((a, b) => Number(b.recent) - Number(a.recent));

	const target = opts.browseTarget;
	if (!target || !target.startsWith(`${opts.origin}/`) || opts.platform === 'desktop') return recentFirst(choices);

	for (const w of KNOWN_WALLETS) {
		if (detected.some((d) => known(d.name) === w)) continue;
		choices.push({ kind: 'browse', key: `browse:${w.id}`, name: w.name, icon: w.icon, href: w.browse(target, opts.origin), recent: isRecent(w.name) });
	}
	return recentFirst(choices);
}
