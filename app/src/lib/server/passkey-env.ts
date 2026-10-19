export type PasskeyEnv = { signerOrigin: string; feePayerKey: string };

/** The signer must be https (or loopback http in development) and a key must pay its fees. */
export function passkeyEnv(
	origin: string | undefined,
	feePayerKey: string | undefined
): PasskeyEnv | null {
	if (!origin || !feePayerKey?.trim()) return null;
	try {
		const url = new URL(origin);
		const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
		if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
		return { signerOrigin: url.origin, feePayerKey: feePayerKey.trim() };
	} catch {
		return null;
	}
}
