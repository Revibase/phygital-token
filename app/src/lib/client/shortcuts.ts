import type { Shortcut } from '$lib/shared/shortcuts';
import { getJson } from './api';
import type { ConnectionMethod } from './memory';
import type { Platform } from './capability';
import { KNOWN_WALLETS, type KnownWallet } from './wallet/catalog';

export async function fetchAccessoryShortcuts(): Promise<Shortcut[]> {
	return (await getJson<{ shortcuts: Shortcut[] }>('/api/accessory/shortcuts')).shortcuts;
}

/** Wallet launches use saved routing or prompt for selection; wallet browsers stay in place. */
export type ShortcutLaunch = { kind: 'link'; href: string; newTab: boolean } | { kind: 'pick' };

export type WalletLaunchOptions = {
	platform: Platform;
	inWallet: boolean;
	recent: string | null;
	method?: ConnectionMethod | null;
	chooseWallet?: boolean;
	origin: string;
};

/** External shortcuts open as plain links; the rest open inside a wallet app's browser. */
export function shortcutLaunch(s: Shortcut, opts: WalletLaunchOptions): ShortcutLaunch {
	if (s.external) return { kind: 'link', href: s.href, newTab: s.href.startsWith('https:') };
	return walletDestinationLaunch(s.href, opts);
}

/** Shared routing for wallet shortcuts and actions that require a wallet signature. */
export function walletDestinationLaunch(
	direct: string,
	opts: WalletLaunchOptions,
	hrefFor = (wallet: KnownWallet) => wallet.browse(new URL(direct, opts.origin).href, opts.origin)
): ShortcutLaunch {
	if (opts.chooseWallet && !opts.inWallet) return { kind: 'pick' };
	if (opts.platform === 'desktop') return { kind: 'link', href: direct, newTab: true };
	if (opts.inWallet) return { kind: 'link', href: direct, newTab: false };
	if (opts.method === 'browser') return { kind: 'link', href: direct, newTab: true };
	const wallet = opts.recent ? KNOWN_WALLETS.find((w) => w.match.test(opts.recent!)) : undefined;
	return wallet ? { kind: 'link', href: hrefFor(wallet), newTab: false } : { kind: 'pick' };
}
