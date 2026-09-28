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
	/** Matches the name a detected Wallet Standard wallet registers with. */
	match: RegExp;
	browse: (target: string, ref: string) => string;
};

const enc = encodeURIComponent;

export const KNOWN_WALLETS: readonly KnownWallet[] = [
	{ id: 'phantom', name: 'Phantom', match: /phantom/i, browse: (t, r) => `https://phantom.app/ul/browse/${enc(t)}?ref=${enc(r)}` },
	{ id: 'backpack', name: 'Backpack', match: /backpack/i, browse: (t, r) => `https://backpack.app/ul/v1/browse/${enc(t)}?ref=${enc(r)}` },
	{ id: 'solflare', name: 'Solflare', match: /solflare/i, browse: (t, r) => `https://solflare.com/ul/v1/browse/${enc(t)}?ref=${enc(r)}` }
];

/** Connector ordering hint: these are listed first when detected. */
export const FEATURED_WALLET_NAMES = KNOWN_WALLETS.map((w) => w.name);

export type WalletChoice =
	/** Detected by the connector: connect in place. */
	| { kind: 'detected'; key: string; connectorId: string; name: string; icon: string; ready: boolean }
	/** Not detected: open `target` inside the wallet's in-app browser. */
	| { kind: 'browse'; key: string; name: string; href: string };

/**
 * Detected wallets first (known ones in our order, then anything else the
 * connector found), then an "Open in …" deep link for each known wallet that
 * wasn't detected — phones only, and only for a same-origin target we built.
 */
export function walletChoices(
	detected: WalletOption[],
	opts: { browseTarget: string | null; platform: Platform; origin: string }
): WalletChoice[] {
	const rank = (name: string) => {
		const i = KNOWN_WALLETS.findIndex((w) => w.match.test(name));
		return i === -1 ? KNOWN_WALLETS.length : i;
	};
	const choices: WalletChoice[] = [...detected]
		.sort((a, b) => rank(a.name) - rank(b.name))
		.map((w) => ({ kind: 'detected', key: `detected:${w.id}`, connectorId: w.id, name: w.name, icon: w.icon, ready: w.ready }));

	const target = opts.browseTarget;
	if (!target || !target.startsWith(`${opts.origin}/`) || opts.platform === 'desktop') return choices;

	for (const w of KNOWN_WALLETS) {
		if (detected.some((d) => w.match.test(d.name))) continue;
		choices.push({ kind: 'browse', key: `browse:${w.id}`, name: w.name, href: w.browse(target, opts.origin) });
	}
	return choices;
}
