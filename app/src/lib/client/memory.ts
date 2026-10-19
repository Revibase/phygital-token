const OLD_OWNER_KEYS = ['revibase:linked:', 'revibase:link-context:'];

/** Owners used to be remembered per accessory; nothing about them is stored now. */
export function clearStoredOwners() {
	try {
		const old = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
			(name): name is string => !!name && OLD_OWNER_KEYS.some((prefix) => name.startsWith(prefix))
		);
		for (const name of old) localStorage.removeItem(name);
	} catch {
		// Storage can be unavailable (private mode); there is nothing to clear then.
	}
}

const RECENT_WALLET = 'revibase:recent-wallet';

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
