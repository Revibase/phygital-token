// Replace only the hardware and transaction boundaries of the link flow.
export async function prepareTap() {
	return { session: { phygitalToken: 'simulated' }, expiresAt: Date.now() + 98_200 };
}
export async function tapAccessory(prepared: { expiresAt: number }) {
	return { ...prepared, response: { simulation: true } };
}
export async function finishLink(_tap: unknown, _ctx: unknown, phase: (p: string) => void) {
	phase('approve');
	if (sessionStorage.getItem('simulation:reject') === 'true')
		throw new Error('User rejected the request.');
	phase('confirming');
	return 'simulated-signature';
}
export async function releaseAccessory() {
	throw new Error('Not part of this simulation');
}
