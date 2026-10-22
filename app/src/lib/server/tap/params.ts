/** Query keys on a signed NFC URL. */
export const TAP_PARAMS = ['pk', 'c', 'n', 's'] as const;

export function hasTapParams(params: URLSearchParams): boolean {
	return TAP_PARAMS.some((key) => params.has(key));
}
