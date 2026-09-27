/**
 * Fixed deep-link templates that open OUR `/continue#h=…` page inside a
 * wallet's in-app browser. Only our own origin is ever wrapped, and the URL is
 * produced by our server — never taken from a query parameter.
 */
export type HandoffWallet = { id: 'phantom' | 'solflare'; name: string; href: string };

export function walletHandoffLinks(handoffUrl: string): HandoffWallet[] {
	const origin = window.location.origin;
	if (!handoffUrl.startsWith(`${origin}/continue#h=`)) return [];
	const target = encodeURIComponent(handoffUrl);
	const ref = encodeURIComponent(origin);
	return [
		{ id: 'phantom', name: 'Phantom', href: `https://phantom.app/ul/browse/${target}?ref=${ref}` },
		{ id: 'solflare', name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${target}?ref=${ref}` }
	];
}
