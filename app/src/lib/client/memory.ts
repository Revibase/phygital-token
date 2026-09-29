const key = (pda: string) => `revibase:linked:${pda}`;

export function rememberedWallet(pda: string): string | null {
	try {
		return localStorage.getItem(key(pda));
	} catch {
		return null;
	}
}

export function rememberWallet(pda: string, wallet: string | null) {
	try {
		if (wallet) localStorage.setItem(key(pda), wallet);
		else localStorage.removeItem(key(pda));
	} catch {
	}
}

const RECENT_WALLET = 'revibase:recent-wallet';

/** The wallet app last connected or linked in this browser (shown first, marked "Recent"). */
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
	}
}
