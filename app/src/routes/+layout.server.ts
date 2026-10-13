import { dev } from '$app/environment';
import { deviceClass, type DeviceClass } from '$lib/shared/device';
import type { LayoutServerLoad } from './$types';

/**
 * Dev only: `?device=mobile` (remembered in a cookie; `?device=auto` clears it)
 * previews the phone UI from a desktop browser. Narrow the window to match.
 */
function devDevice(
	url: URL,
	cookies: Parameters<LayoutServerLoad>[0]['cookies']
): DeviceClass | null {
	if (!dev) return null;
	const asked = url.searchParams.get('device');
	if (asked === 'mobile')
		cookies.set('dev_device', 'mobile', {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: false
		});
	if (asked === 'auto') cookies.delete('dev_device', { path: '/' });
	return asked === 'mobile' || (asked !== 'auto' && cookies.get('dev_device') === 'mobile')
		? 'mobile'
		: null;
}

export const load: LayoutServerLoad = ({ platform, request, url, cookies }) => ({
	cluster: (platform?.env?.SOLANA_CLUSTER ?? 'devnet') as
		'mainnet' | 'devnet' | 'testnet' | 'localnet',
	rpcUrl: platform?.env?.SOLANA_RPC_URL ?? '',
	signerOrigin: platform?.env?.SECURE_SIGNER_ORIGIN ?? '',
	device: devDevice(url, cookies) ?? deviceClass(request.headers.get('user-agent'))
});
