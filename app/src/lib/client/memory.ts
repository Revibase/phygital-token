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
type Saved = { wallet?: unknown; app?: unknown; pda?: unknown; source?: unknown };
const parseSaved = (raw: string): Saved | null => JSON.parse(raw) as Saved | null;

/** The wallet last connected in this browser (shown first, marked "Recent"). */
export function recentWallet(): string | null {
	try {
		return localStorage.getItem(RECENT_WALLET);
	} catch {
		return null;
	}
}

export function rememberRecentWallet(name: string | null | undefined) {
	try {
		if (name) localStorage.setItem(RECENT_WALLET, name);
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}

export type OwnerContext = {
	wallet: string;
	app: string | null;
	source: 'desktop' | 'mobile' | 'wallet';
};

/** Where this browser claimed the accessory. Shown on the owner row. */
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
		const keys = [key(pda), `revibase:link-context:${pda}`];
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
			if (apps.includes(recentWallet() ?? '')) localStorage.removeItem(RECENT_WALLET);
		}
		return stale;
	} catch {
		return false;
	}
}

/** Forget this accessory's claim details. The linked address stays. */
export function forgetOwnerDetails(pda: string) {
	try {
		localStorage.removeItem(`revibase:link-context:${pda}`);
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}
