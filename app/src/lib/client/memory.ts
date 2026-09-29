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
