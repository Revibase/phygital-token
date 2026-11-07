import { bytesEqual } from '#lib/shared/encoding.ts';

/** Compare an `Authorization` header to the secret without leaking where they differ. */
export async function authHeaderMatches(header: string | null, secret: string): Promise<boolean> {
	if (header === null) return false;
	const digest = async (value: string) =>
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
	const [a, b] = await Promise.all([digest(header), digest(secret)]);
	return bytesEqual(a, b);
}
