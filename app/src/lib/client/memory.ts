/**
 * Per-device memory of which wallet this browser linked to an accessory.
 * Public information only (a wallet address) — used to notice when the link
 * changed elsewhere. Storage may be unavailable (private mode); never required.
 */
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
		// best effort
	}
}
