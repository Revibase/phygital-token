import { browser } from '$app/environment';

const IN_APP_BROWSER_PATTERNS = [
	/phantom/i,
	/solflare/i,
	/backpack/i,
	/trust\/?wallet/i,
	/metamask/i,
	/coinbase/i,
	/okex|okx/i,
	/rainbow/i,
	/zerion/i
];

/** Heuristic detection of wallet in-app browsers (WebView) where WebAuthn is unavailable. */
export function isLikelyInAppBrowser(): boolean {
	if (!browser) {
		return false;
	}

	const ua = navigator.userAgent;

	if (IN_APP_BROWSER_PATTERNS.some((pattern) => pattern.test(ua))) {
		return true;
	}

	// Generic WebView markers (Android/iOS)
	if (/;\s*wv\)/i.test(ua) || /WebView/i.test(ua)) {
		return true;
	}

	return false;
}

export function isWebAuthnAvailable(): boolean {
	if (!browser) {
		return false;
	}

	return typeof window.PublicKeyCredential !== 'undefined';
}

export function canClaimInThisBrowser(): boolean {
	return isWebAuthnAvailable() && !isLikelyInAppBrowser();
}
