const key = (pda: string) => `revibase:linked:${pda}`;

/** The owner this browser last linked an accessory to, to notice when it changes elsewhere. */
export function rememberedWallet(pda: string): string | null {
	try {
		return localStorage.getItem(key(pda));
	} catch {
		return null;
	}
}

export function rememberWallet(pda: string, wallet: string | null) {
	reconcileAccessoryWallet(pda, wallet);
	try {
		if (wallet) localStorage.setItem(key(pda), wallet);
		else localStorage.removeItem(key(pda));
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}

const RECENT_WALLET = 'revibase:recent-wallet';

/** A stored preference record; every field is checked before use. */
type Saved = { wallet?: unknown; app?: unknown; method?: unknown; pda?: unknown; source?: unknown };
const parseSaved = (raw: string): Saved | null => JSON.parse(raw) as Saved | null;

/** The wallet app last connected or linked in this browser (shown first, marked "Recent"). */
export function recentWallet(): string | null {
	try {
		return localStorage.getItem(RECENT_WALLET);
	} catch {
		return null;
	}
}

export type ConnectionMethod = 'browser' | 'wallet';

export function recentConnectionMethod(): ConnectionMethod | null {
	try {
		const method = localStorage.getItem('revibase:connection-method');
		return method === 'browser' || method === 'wallet' ? method : recentWallet() ? 'wallet' : null;
	} catch {
		return null;
	}
}

export function rememberRecentWallet(
	name: string | null | undefined,
	method: ConnectionMethod = 'wallet'
) {
	try {
		if (name) localStorage.setItem(RECENT_WALLET, name);
		localStorage.setItem('revibase:connection-method', method);
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}

/** An accessory preference is bound to its current linked address. */
export function accessoryWalletApp(pda: string, owner: string | null): string | null {
	if (reconcileAccessoryWallet(pda, owner)) return null;
	try {
		const raw = localStorage.getItem(`revibase:wallet-app:${pda}`);
		if (!raw) return null;
		const saved = parseSaved(raw);
		if (!saved || saved.wallet !== owner) {
			localStorage.removeItem(`revibase:wallet-app:${pda}`);
			return null;
		}
		return typeof saved.app === 'string' ? saved.app : null;
	} catch {
		return null;
	}
}

export function rememberAccessoryWalletApp(
	pda: string,
	wallet: string | null,
	app: string | null | undefined,
	method: ConnectionMethod = 'wallet'
) {
	try {
		localStorage.removeItem(`revibase:choose-wallet:${pda}`);
		if (app || method === 'browser')
			localStorage.setItem(
				`revibase:wallet-app:${pda}`,
				JSON.stringify({ pda, wallet, app: app ?? 'Browser', method })
			);
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}

/** Legacy app-only records retain their original wallet-browser behavior. */
export function accessoryConnectionMethod(
	pda: string,
	owner: string | null
): ConnectionMethod | null {
	if (!accessoryWalletApp(pda, owner)) return null;
	try {
		const saved = parseSaved(localStorage.getItem(`revibase:wallet-app:${pda}`)!);
		return saved?.method === 'browser' ? 'browser' : 'wallet';
	} catch {
		return null;
	}
}

export type OwnerContext = {
	wallet: string;
	app: string | null;
	source: 'desktop' | 'mobile' | 'wallet';
};
/** Link provenance is separate from the user's shortcut launch preference. */
export function rememberAccessoryLink(pda: string, context: OwnerContext) {
	try {
		localStorage.setItem(`revibase:link-context:${pda}`, JSON.stringify({ ...context, pda }));
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}
export function accessoryLinkContext(pda: string, wallet: string | null): OwnerContext | null {
	if (reconcileAccessoryWallet(pda, wallet)) return null;
	try {
		const saved = parseSaved(localStorage.getItem(`revibase:link-context:${pda}`) ?? 'null');
		if (!saved || !wallet || saved.wallet !== wallet) return null;
		const source = saved.source;
		if (source !== 'desktop' && source !== 'mobile' && source !== 'wallet') return null;
		return { wallet, app: typeof saved.app === 'string' ? saved.app : null, source };
	} catch {
		return null;
	}
}

/** Remove all accessory-scoped wallet hints when authoritative linkage disagrees. */
export function reconcileAccessoryWallet(pda: string, wallet: string | null): boolean {
	try {
		const keys = [key(pda), `revibase:wallet-app:${pda}`, `revibase:link-context:${pda}`];
		let stale = false;
		const apps: string[] = [];
		for (const [i, name] of keys.entries()) {
			const raw = localStorage.getItem(name);
			if (!raw) continue;
			try {
				const saved: Saved | null = i === 0 ? { wallet: raw } : parseSaved(raw);
				if (typeof saved?.app === 'string') apps.push(saved.app);
				if (!wallet || saved?.wallet !== wallet || (saved.pda && saved.pda !== pda)) stale = true;
			} catch {
				stale = true;
			}
		}
		if (stale) {
			for (const name of keys) localStorage.removeItem(name);
			if (apps.includes(recentWallet() ?? '')) {
				localStorage.removeItem(RECENT_WALLET);
				localStorage.removeItem('revibase:connection-method');
			}
		}
		return stale;
	} catch {
		return false;
	}
}

/** Forget only this accessory's app hints; keep its linked address and other preferences. */
export function forgetOwnerDetails(pda: string) {
	try {
		localStorage.removeItem(`revibase:wallet-app:${pda}`);
		localStorage.removeItem(`revibase:link-context:${pda}`);
		localStorage.setItem(`revibase:choose-wallet:${pda}`, 'true');
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}
export function shouldChooseWallet(pda: string): boolean {
	try {
		return localStorage.getItem(`revibase:choose-wallet:${pda}`) === 'true';
	} catch {
		return false;
	}
}
