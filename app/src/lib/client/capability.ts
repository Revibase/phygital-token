const IN_APP_BROWSER_PATTERNS = [
	/phantom/i,
	/solflare/i,
	/backpack/i,
	/trust\/?wallet/i,
	/metamask/i,
	/coinbase/i,
	/okex|okx/i,
	/;\s*wv\)/i // Android WebView
];

export type Platform = 'ios' | 'android' | 'desktop';

export function platform(): Platform {
	const ua = navigator.userAgent;
	if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
	if (/Android/i.test(ua)) return 'android';
	return 'desktop';
}

/** Heuristic: wallet in-app browsers (WebViews) generally cannot run WebAuthn for our origin. */
export function isLikelyWalletBrowser(): boolean {
	return IN_APP_BROWSER_PATTERNS.some((p) => p.test(navigator.userAgent));
}

export function canTapHere(): boolean {
	return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined' && !isLikelyWalletBrowser();
}

/** Where to hold the accessory for the security-key (FIDO) tap. */
export function tapHint(p: Platform = platform()): string {
	if (p === 'ios') return 'Hold your accessory near the top of your iPhone.';
	if (p === 'android') return 'Hold your accessory to the back of your phone.';
	return 'Hold your accessory to your NFC reader.';
}
