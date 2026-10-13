import { describe, expect, it } from 'vitest';
import { deviceClass, phoneUrl } from '$lib/shared/device';

describe('desktop gate', () => {
	it('classifies phones, computers and ambiguous Macs', () => {
		expect(
			deviceClass(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
			)
		).toBe('mobile');
		expect(
			deviceClass(
				'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'
			)
		).toBe('mobile');
		expect(
			deviceClass(
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'
			)
		).toBe('desktop');
		expect(
			deviceClass(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
			)
		).toBe('mac');
		expect(deviceClass(null)).toBe('desktop');
	});

	it('never puts single-use tap parameters in the phone link', () => {
		expect(phoneUrl(new URL('https://portal.revibase.com/accessory?pk=a&c=b&n=1&s=2'))).toBe(
			'https://portal.revibase.com/accessory'
		);
		expect(phoneUrl(new URL('https://portal.revibase.com/accessory/link?link=abc&x=1'))).toBe(
			'https://portal.revibase.com/accessory/link?link=abc'
		);
		expect(phoneUrl(new URL('https://portal.revibase.com/wallet/pda#frag'))).toBe(
			'https://portal.revibase.com/wallet/pda'
		);
	});
});
