import type { Shortcut } from '$lib/shared/shortcuts';
import { getJson } from './api';
import type { ConnectionMethod } from './memory';
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

/** Wallet launches use saved routing or prompt for selection; wallet browsers stay in place. */
export type ShortcutLaunch = { kind: 'link'; href: string; newTab: boolean } | { kind: 'pick' };

export function shortcutLaunch(
	s: Shortcut,
	opts: { platform: Platform; inWallet: boolean; recent: string | null; method?: ConnectionMethod | null; chooseWallet?: boolean; origin: string },
	/** Position in the server's list; the routes look the shortcut up again by it. */
	index: number
): ShortcutLaunch {
	if (s.immerse) return { kind: 'link', href: `/accessory/app/${index}`, newTab: false };
	const direct = s.proof ? openPath(index) : s.href;
	if (s.external) return { kind: 'link', href: direct, newTab: s.href.startsWith('https:') };
	return walletDestinationLaunch(direct, opts, wallet => walletLaunchHref(s, index, wallet, opts.origin));
}

export type WalletLaunchOptions = { platform: Platform; inWallet: boolean; recent: string | null; method?: ConnectionMethod | null; chooseWallet?: boolean; origin: string };

/** Shared routing for wallet shortcuts and actions that require a wallet signature. */
export function walletDestinationLaunch(direct: string, opts: WalletLaunchOptions, hrefFor = (wallet: KnownWallet) => wallet.browse(new URL(direct, opts.origin).href, opts.origin)): ShortcutLaunch {
	if (opts.chooseWallet && !opts.inWallet) return { kind: 'pick' };
	if (opts.platform === 'desktop') return { kind: 'link', href: direct, newTab: true };
	if (opts.inWallet) return { kind: 'link', href: direct, newTab: false };
	if (opts.method === 'browser') return { kind: 'link', href: direct, newTab: true };
	const wallet = opts.recent ? KNOWN_WALLETS.find(w => w.match.test(opts.recent!)) : undefined;
	return wallet ? { kind: 'link', href: hrefFor(wallet), newTab: false } : { kind: 'pick' };
}
