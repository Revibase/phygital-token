import { getJson, postJson } from '../../src/lib/client/api';
// Exercise real API helpers and polling, replace only hardware/transaction boundaries.
export { pollLink, linkStatus, cancelLink, claimHandoff, prepareTap, startPhoneLink } from '../../src/lib/client/link/flow';
export async function tapWithChallenge(fields: { linkId: string }) {
	return postJson(`/api/link/${fields.linkId}/assertion`, { response: { simulation: true } });
}
export async function finishInWallet(id: string, ctx: { address: string; wallet: { name: string } }, phase: (p: string) => void) {
	phase('approve');
	if (sessionStorage.getItem('simulation:reject') === 'true') throw new Error('User rejected the request.');
	await postJson(`/api/link/${id}/recipient`, { address: ctx.address });
	phase('confirming');
	return postJson(`/api/link/${id}/submitted`, { signature: 'simulated-signature', app: ctx.wallet.name });
}
export async function releaseAccessory() {
	throw new Error('Not part of this simulation');
}
