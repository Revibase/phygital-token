export async function prepareTap(secp256r1Pubkey: string, rpId: string) {
	return {
		expiresAt: Date.now() + 60_000,
		session: { phygitalToken: secp256r1Pubkey, rpId }
	};
}

export async function tapAccessory(prepared: Awaited<ReturnType<typeof prepareTap>>) {
	return { ...prepared, response: {} };
}

export async function finishLink(
	_tap: unknown,
	_ctx: unknown,
	onPhase: (phase: 'preparing' | 'approve' | 'confirming') => void = () => {}
) {
	if (sessionStorage.getItem('simulation:reject') === 'true') throw new Error('Wallet rejected');
	onPhase('preparing');
	onPhase('approve');
	onPhase('confirming');
	return 'simulation-signature';
}
