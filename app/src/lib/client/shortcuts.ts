import type { Shortcut } from '$lib/shared/shortcuts';
import { getJson } from './api';
import type { Platform } from './capability';
import { KNOWN_WALLETS, type KnownWallet } from './wallet/catalog';

export async function fetchAccessoryShortcuts(): Promise<Shortcut[]> {
	return (await getJson<{ shortcuts: Shortcut[] }>('/api/accessory/shortcuts')).shortcuts;
}

/** Mints the session proof at the click. `wallet` wraps the redirect in that wallet's browse link. */
export const openPath = (index: number, wallet?: KnownWallet['id']) => `/shortcut/${index}${wallet ? `?wallet=${wallet}` : ''}`;

export function walletLaunchHref(s: Shortcut, index: number, wallet: KnownWallet, origin: string): string {
	return s.proof ? openPath(index, wallet.id) : wallet.browse(s.href, origin);
}

/**
 * `pick`: it should open inside a wallet, but this phone browser has none we know of, so ask.
 * Wallet shortcuts open in a new tab on a computer, in place inside a wallet browser, and otherwise in the
 * recent wallet app.
 */
export type ShortcutLaunch = { kind: 'link'; href: string; newTab: boolean } | { kind: 'pick' };

export function shortcutLaunch(
	s: Shortcut,
	opts: { platform: Platform; inWallet: boolean; recent: string | null; origin: string },
	/** Position in the server's list; the routes look the shortcut up again by it. */
	index: number
): ShortcutLaunch {
	if (s.immerse) return { kind: 'link', href: `/accessory/app/${index}`, newTab: false };
	const direct = s.proof ? openPath(index) : s.href;
	if (s.external) return { kind: 'link', href: direct, newTab: s.href.startsWith('https:') };
	if (opts.platform === 'desktop') return { kind: 'link', href: direct, newTab: true };
	if (opts.inWallet) return { kind: 'link', href: direct, newTab: false };
	const wallet = opts.recent ? KNOWN_WALLETS.find((w) => w.match.test(opts.recent!)) : undefined;
	return wallet ? { kind: 'link', href: walletLaunchHref(s, index, wallet, opts.origin), newTab: false } : { kind: 'pick' };
}
