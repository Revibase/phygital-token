import type { ProgramIdl } from '$lib/shared/program-idl';

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
	try {
		if (wallet) localStorage.setItem(key(pda), wallet);
		else localStorage.removeItem(key(pda));
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}

const RECENT_WALLET = 'revibase:recent-wallet';
const WALLET_INTRO = 'revibase:accessory-wallet-intro:v1';

export function hasSeenWalletIntro(): boolean {
	try {
		return localStorage.getItem(WALLET_INTRO) === 'seen';
	} catch {
		return false;
	}
}

export function rememberWalletIntro() {
	try {
		localStorage.setItem(WALLET_INTRO, 'seen');
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}

/** The wallet app last connected in this browser (shown first, marked "Recent"). */
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

const SAVED_IDLS = 'revibase:program-idls';

/** Program descriptions uploaded this session, already parsed, by program address. */
export function savedIdls(): Record<string, ProgramIdl> {
	try {
		const value: unknown = JSON.parse(sessionStorage.getItem(SAVED_IDLS) ?? '{}');
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, ProgramIdl>)
			: {};
	} catch {
		return {};
	}
}

export function rememberIdl(idl: ProgramIdl) {
	try {
		sessionStorage.setItem(SAVED_IDLS, JSON.stringify({ ...savedIdls(), [idl.address]: idl }));
	} catch {
		// Storage can be unavailable (private mode, quota); remembering is best-effort.
	}
}
