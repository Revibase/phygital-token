/**
 * Local end-to-end check of the whole linking ceremony against a real program.
 *
 *   solana-test-validator --reset --bpf-program DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ target/deploy/phygital_token.so
 *   (app/.dev.vars: SOLANA_RPC_URL=http://127.0.0.1:8899, SOLANA_CLUSTER=localnet)
 *   pnpm --filter revibase dev
 *   pnpm --filter revibase e2e:local
 *
 * A software "accessory" plays both chip roles: the NDEF key that signs
 * dynamic tap URLs and the FIDO key that answers WebAuthn. Browsers are
 * simulated with separate cookie jars (phone Safari, wallet in-app browser,
 * desktop), talking to the real SvelteKit routes.
 */
import { address, generateKeyPairSigner } from '@solana/kit';
import {
	fetchPhygitalToken,
	findAdminConfigPda,
	findPhygitalTokenPda,
	getCreateConfigInstructionAsync,
	getInitializeInstructionAsync,
	getRemoveLinkedWalletInstruction,
	getSetIssuerInstructionAsync,
	PhygitalTokenType
} from 'phygital-token-sdk';

import { base64UrlToBytes, bytesToBase64Url } from '../src/lib/shared/encoding';
import type { LinkStatusView, TransferChallenge } from '../src/lib/shared/types';
import { APP, Browser, check, failures, fakeAccessory, finish, funded, rpc, send } from './lib';

/** Phone taps and approves; a wallet browser claims the handoff and finishes. */
async function linkViaHandoff(acc: ReturnType<typeof fakeAccessory>, wallet: Awaited<ReturnType<typeof funded>>, label: string) {
	const phone = new Browser(`${label}-phone`);
	const walletBrowser = new Browser(`${label}-wallet`);
	await phone.open(acc.tapUrl());
	const start = await phone.post<LinkStatusView>('/api/link');
	check(`${label}: ceremony started`, start.status === 200, start.body);
	const ch = await phone.post<TransferChallenge>(`/api/link/${start.body.id}/challenge`);
	const res = await phone.post<{ handoffUrl: string }>(`/api/link/${start.body.id}/assertion`, { response: acc.webauthn(ch.body.challenge) });
	await walletBrowser.post('/api/handoff/claim', { h: new URL(res.body.handoffUrl).hash.replace('#h=', '') });
	await finish(walletBrowser, start.body.id, wallet);
}

async function main() {
	console.log(`E2E against ${APP} + local validator`);

	// Issuer setup (admin → issuer → initialize a Bearer token for our fake accessory).
	const admin = await funded();
	const issuer = await funded();
	const [adminConfig] = await findAdminConfigPda();
	if ((await rpc.getAccountInfo(adminConfig, { encoding: 'base64' }).send()).value) {
		throw new Error('AdminConfig already exists (create_config is once-only). Restart solana-test-validator with --reset.');
	}
	await send(admin, [await getCreateConfigInstructionAsync({ authority: admin })]);
	await send(admin, [await getSetIssuerInstructionAsync({ admin, issuer: issuer.address })]);
	const acc = fakeAccessory();
	const pda = await findPhygitalTokenPda([acc.passkey]);
	await send(issuer, [
		await getInitializeInstructionAsync({
			authority: issuer,
			adminConfig,
			phygitalToken: pda,
			identifier: [acc.identifier],
			secp256r1Pubkey: [acc.passkey],
			tokenType: PhygitalTokenType.Bearer,
			linkedWallet: address('11111111111111111111111111111111')
		})
	]);
	console.log(`• token ${pda} initialized (Bearer, unlinked)`);

	// ---------------------------------------------------------------- phone → wallet app
	console.log('\nPhone tap → handoff to wallet app');
	const safari = new Browser('safari');
	const walletBrowser = new Browser('wallet');
	const intruder = new Browser('intruder');

	const url = acc.tapUrl();
	const tap = await safari.open(url);
	check('NFC tap verified, session issued, 303 to clean /accessory', tap.status === 303 && tap.location === '/accessory', tap);

	const replay = await intruder.open(url);
	check('Replaying the same tap URL elsewhere is rejected', replay.location === '/tap/replayed', replay);
	const reopen = await safari.open(url);
	check('Re-opening the same URL in the same browser just continues', reopen.location === '/accessory', reopen);

	const forged = await intruder.open(url.replace(/c=\d+/, 'c=999999'));
	check('A tap URL with an altered counter is rejected', forged.location === '/tap/invalid', forged);

	const start = await safari.post<LinkStatusView>('/api/link');
	check('Link ceremony created', start.status === 200 && start.body.state === 'created', start.body);
	const linkId = start.body.id;

	const stolen = await intruder.post(`/api/link/${linkId}/challenge`);
	check('Another browser cannot drive this ceremony', stolen.status === 403, stolen);

	const ch = await safari.post<TransferChallenge>(`/api/link/${linkId}/challenge`);
	check('Slot-bound challenge issued via SDK beginTransfer', ch.status === 200 && ch.body.challenge.length === 43, ch.body);

	const wrongOrigin = acc.webauthn(ch.body.challenge);
	const cd = JSON.parse(new TextDecoder().decode(base64UrlToBytes(wrongOrigin.response.clientDataJSON)));
	cd.origin = 'https://phish.example';
	wrongOrigin.response.clientDataJSON = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cd)));
	const phish = await safari.post(`/api/link/${linkId}/assertion`, { response: wrongOrigin });
	check('Assertion from another origin is refused', phish.status === 400, phish.body);

	const accepted = await safari.post<{ status: LinkStatusView; handoffUrl: string }>(`/api/link/${linkId}/assertion`, {
		response: acc.webauthn(ch.body.challenge)
	});
	check('Tap accepted into custody; handoff link minted', accepted.status === 200 && !!accepted.body.handoffUrl, accepted.body);
	const h = new URL(accepted.body.handoffUrl).hash.replace('#h=', '');
	check('Handoff capability travels only in the URL fragment', !accepted.body.handoffUrl.includes('?'));

	const early = await walletBrowser.post(`/api/link/${linkId}/recipient`, { address: (await generateKeyPairSigner()).address });
	check('Tap is not released before the handoff link is claimed', early.status === 403, early);

	const claim = await walletBrowser.post<LinkStatusView>('/api/handoff/claim', { h });
	check('Wallet browser claims the handoff link', claim.status === 200 && claim.body.state === 'claimed', claim.body);
	const second = await intruder.post('/api/handoff/claim', { h });
	check('A second claim of the same link fails', second.status === 409, second.body);
	const safariView = await safari.get<LinkStatusView>(`/api/link/${linkId}`);
	check('Tapping browser sees the second-claim alarm', safariView.body.claimConflict === true, safariView.body);

	const poorWallet = await generateKeyPairSigner();
	const poor = await walletBrowser.post<{ code?: string }>(`/api/link/${linkId}/recipient`, { address: poorWallet.address });
	check('A wallet with no SOL gets a clear "add SOL" answer from simulation', poor.body.code === 'insufficient_sol', poor.body);

	const owner = await funded();
	await finish(walletBrowser, linkId, owner);
	const onchain = await fetchPhygitalToken(rpc, pda, { commitment: 'confirmed' });
	check('On-chain linked_wallet is the wallet that approved', onchain.data.linkedWallet === owner.address, onchain.data.linkedWallet);
	const firstSignCount = onchain.data.lastSignCount;
	const originView = await safari.get<LinkStatusView>(`/api/link/${linkId}`);
	check('Tapping browser sees success', originView.body.state === 'linked' && originView.body.recipient === owner.address, originView.body);

	// ---------------------------------------------------------------- desktop pairing
	console.log('\nDesktop shows QR → phone scans → taps → desktop signs');
	const desktop = new Browser('desktop');
	const phone = new Browser('phone');
	const pair = await desktop.post<{ status: LinkStatusView; pairUrl: string }>('/api/pair');
	check('Desktop pairing created with QR capability', pair.status === 200 && pair.body.pairUrl.includes('/pair#p='), pair.body);
	const desktopId = pair.body.status.id;
	const p = pair.body.pairUrl.split('#p=')[1];

	const scan = await phone.post<LinkStatusView>('/api/pair/claim', { p });
	check('Phone scanned the QR', scan.status === 200 && scan.body.state === 'paired', scan.body);
	const rescan = await intruder.post('/api/pair/claim', { p });
	check('A second phone cannot use the same QR', rescan.status === 409, rescan.body);

	const phoneTap = await phone.open(acc.tapUrl());
	check('Accessory tap attaches to the desktop pairing', phoneTap.location === `/accessory/link?link=${desktopId}`, phoneTap);

	const attached = await desktop.get<LinkStatusView>(`/api/link/${desktopId}`);
	const phoneSees = await phone.get<LinkStatusView>(`/api/link/${desktopId}`);
	check(
		'Both screens show the same pairing code',
		!!attached.body.pairingCode && attached.body.pairingCode === phoneSees.body.pairingCode,
		{ desktop: attached.body.pairingCode, phone: phoneSees.body.pairingCode }
	);

	const tooEarly = await phone.post(`/api/link/${desktopId}/challenge`);
	check('Phone cannot approve before the desktop confirms the accessory', tooEarly.status === 409, tooEarly.body);
	const confirmed = await desktop.post<LinkStatusView>(`/api/link/${desktopId}/confirm-accessory`);
	check('Desktop confirms the accessory', confirmed.body.state === 'accessory_confirmed', confirmed.body);

	const ch2 = await phone.post<TransferChallenge>(`/api/link/${desktopId}/challenge`);
	const acc2 = await phone.post<{ handoffUrl: string | null; status: LinkStatusView }>(`/api/link/${desktopId}/assertion`, {
		response: acc.webauthn(ch2.body.challenge)
	});
	check('Phone tap accepted; no handoff link (desktop is the pre-bound finisher)', acc2.status === 200 && acc2.body.handoffUrl === null, acc2.body);

	const phoneSteal = await phone.post(`/api/link/${desktopId}/recipient`, { address: owner.address });
	check('Phone cannot take the finisher role', phoneSteal.status === 403, phoneSteal.body);

	const newOwner = await funded();
	await finish(desktop, desktopId, newOwner);
	const after = await fetchPhygitalToken(rpc, pda, { commitment: 'confirmed' });
	check('Bearer accessory moved to the desktop wallet', after.data.linkedWallet === newOwner.address, after.data.linkedWallet);
	check('Sign count advanced on-chain (old taps are dead)', after.data.lastSignCount > firstSignCount, {
		before: firstSignCount,
		after: after.data.lastSignCount
	});

	// ---------------------------------------------------------------- Controlled
	console.log('\nControlled: link → refused re-link → release → link a different wallet');
	const ctl = fakeAccessory();
	const ctlPda = await findPhygitalTokenPda([ctl.passkey]);
	await send(issuer, [
		await getInitializeInstructionAsync({
			authority: issuer,
			adminConfig,
			phygitalToken: ctlPda,
			identifier: [ctl.identifier],
			secp256r1Pubkey: [ctl.passkey],
			tokenType: PhygitalTokenType.Controlled,
			linkedWallet: address('11111111111111111111111111111111')
		})
	]);
	const ctlOwner = await funded();
	await linkViaHandoff(ctl, ctlOwner, 'controlled');
	const ctlLinked = await fetchPhygitalToken(rpc, ctlPda, { commitment: 'confirmed' });
	check('Controlled accessory linked and locked', ctlLinked.data.linkedWallet === ctlOwner.address && ctlLinked.data.isLocked === 1, ctlLinked.data);

	const ctlPhone = new Browser('ctl-phone');
	await ctlPhone.open(ctl.tapUrl());
	const ctlView = await ctlPhone.get<{ accessory: { canLink: boolean; canRelease: boolean } }>('/api/accessory');
	check('App offers release but not "link a different wallet"', ctlView.body.accessory.canLink === false && ctlView.body.accessory.canRelease === true, ctlView.body);
	const ctlRelink = await ctlPhone.post<{ code?: string }>('/api/link');
	check('Server refuses to start a re-link while Controlled is linked', ctlRelink.status === 409 && ctlRelink.body.code === 'accessory_locked', ctlRelink.body);

	await send(ctlOwner, [getRemoveLinkedWalletInstruction({ linkedWallet: ctlOwner, phygitalToken: ctlPda })]);
	const ctlReleased = await fetchPhygitalToken(rpc, ctlPda, { commitment: 'confirmed' });
	check('Linked wallet released it (no accessory needed)', ctlReleased.data.isLocked === 0 && ctlReleased.data.linkedWallet === address('11111111111111111111111111111111'), ctlReleased.data);

	const ctlNext = await funded();
	await linkViaHandoff(ctl, ctlNext, 'controlled-2');
	const ctlRelinked = await fetchPhygitalToken(rpc, ctlPda, { commitment: 'confirmed' });
	check('After release, it links to a different wallet', ctlRelinked.data.linkedWallet === ctlNext.address, ctlRelinked.data.linkedWallet);

	// ---------------------------------------------------------------- Permanent
	console.log('\nPermanent: fixed forever');
	const perm = fakeAccessory();
	const permPda = await findPhygitalTokenPda([perm.passkey]);
	const permOwner = await funded();
	await send(issuer, [
		await getInitializeInstructionAsync({
			authority: issuer,
			adminConfig,
			phygitalToken: permPda,
			identifier: [perm.identifier],
			secp256r1Pubkey: [perm.passkey],
			tokenType: PhygitalTokenType.Permanent,
			linkedWallet: permOwner.address
		})
	]);
	const permPhone = new Browser('perm-phone');
	await permPhone.open(perm.tapUrl());
	const permView = await permPhone.get<{ accessory: { canLink: boolean; canRelease: boolean } }>('/api/accessory');
	check('App offers neither link nor release', !permView.body.accessory.canLink && !permView.body.accessory.canRelease, permView.body);
	const permLink = await permPhone.post<{ code?: string }>('/api/link');
	check('Server refuses to start a link', permLink.status === 409 && permLink.body.code === 'accessory_permanent', permLink.body);
	let permRemoveFailed = false;
	try {
		await send(permOwner, [getRemoveLinkedWalletInstruction({ linkedWallet: permOwner, phygitalToken: permPda })]);
	} catch {
		permRemoveFailed = true;
	}
	check('Program rejects release (PermanentLinkedWalletImmutable)', permRemoveFailed);

	// ---------------------------------------------------------------- Sign in with accessory
	console.log('\nSign in with accessory (off-chain)');
	const partner = new Browser('partner-app');
	const sc = await partner.post<{ challengeId: string; message: string }>('/api/signin/challenge');
	const tapResponse = acc.webauthn(bytesToBase64Url(new TextEncoder().encode(sc.body.message)));
	const signedIn = await partner.post<{ wallet: string | null }>('/api/signin/verify', { challengeId: sc.body.challengeId, response: tapResponse });
	check('A tap signs in as the linked wallet', signedIn.status === 200 && signedIn.body.wallet === newOwner.address, signedIn.body);
	const replayed = await partner.post('/api/signin/verify', { challengeId: sc.body.challengeId, response: tapResponse });
	check('The same sign-in cannot be replayed', replayed.status === 409, replayed.body);

	console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
