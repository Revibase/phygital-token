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
 * simulated with separate cookie jars, talking to the real SvelteKit routes;
 * links run the way the link page does: tap over a fresh challenge, then the
 * wallet signs and sends.
 */
import { address, airdropFactory, createNoopSigner, createSolanaRpcSubscriptions, generateKeyPairSigner, lamports, type Address, type KeyPairSigner } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
	fetchPhygitalToken,
	findAdminConfigPda,
	findPhygitalTokenPda,
	buildExecuteWithOwnerInstruction,
	findPolicyPda,
	findWalletPda,
	getCreateConfigInstructionAsync,
	getInitializeInstructionAsync,
	getPolicyCloseAccounts,
	getRemoveOwnerInstruction,
	getSetIssuerInstructionAsync,
	isPhygitalTokenLocked,
	PhygitalTokenType
} from 'phygital-token-sdk';

import { DAY_SECONDS, emptyDraft, policyDiff, SOL, tapPaymentsPreset } from '../src/lib/shared/policy-draft';
import { buildPolicyInstruction, buildRefillInstruction } from '../src/lib/shared/wallet-instructions';
import { APP, Browser, check, failures, fakeAccessory, funded, link, linkSponsored, prepaid, rpc, send, sendSponsored, SPONSOR } from './lib';

/** Whether the app opens its link page for the accessory this browser just tapped. */
async function linkPageOpens(acc: ReturnType<typeof fakeAccessory>, label: string) {
	const phone = new Browser(`${label}-phone`);
	await phone.open(acc.tapUrl());
	const page = await phone.open(`${APP}/accessory/link`);
	return page.status === 200;
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
			owner: address('11111111111111111111111111111111')
		})
	]);
	console.log(`• token ${pda} initialized (Bearer, unlinked)`);

	console.log('\nPhone tap → approve with the accessory → approve in a wallet');
	const safari = new Browser('safari');
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

	const linkPage = await safari.open(`${APP}/accessory/link`);
	check('The tapping browser can open the link page', linkPage.status === 200, linkPage);
	const noTap = await intruder.open(`${APP}/accessory/link`);
	check('A browser without a fresh tap is sent to tap again', noTap.location === '/tap/expired', noTap);

	const owner = await funded();
	await link(acc, owner);
	const onchain = await fetchPhygitalToken(rpc, pda, { commitment: 'confirmed' });
	check('On-chain owner is the wallet that approved', onchain.data.owner === owner.address, onchain.data.owner);
	const firstSignCount = onchain.data.lastSignCount;

	console.log('\nBearer: a second tap moves it to another wallet');
	const newOwner = await funded();
	await link(acc, newOwner);
	const after = await fetchPhygitalToken(rpc, pda, { commitment: 'confirmed' });
	check('Bearer accessory moved to the new wallet', after.data.owner === newOwner.address, after.data.owner);
	check('Sign count advanced on-chain (old taps are dead)', after.data.lastSignCount > firstSignCount, {
		before: firstSignCount,
		after: after.data.lastSignCount
	});

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
			owner: address('11111111111111111111111111111111')
		})
	]);
	const ctlOwner = await funded();
	await link(ctl, ctlOwner);
	const ctlLinked = await fetchPhygitalToken(rpc, ctlPda, { commitment: 'confirmed' });
	check('Controlled accessory linked and locked', ctlLinked.data.owner === ctlOwner.address && isPhygitalTokenLocked(ctlLinked.data), ctlLinked.data);

	const ctlPhone = new Browser('ctl-phone');
	await ctlPhone.open(ctl.tapUrl());
	const ctlView = await ctlPhone.get<{ accessory: { canLink: boolean; canRelease: boolean } }>('/api/accessory');
	check('App offers release but not "link a different wallet"', ctlView.body.accessory.canLink === false && ctlView.body.accessory.canRelease === true, ctlView.body);
	check('The link page sends a linked Controlled accessory back', !(await linkPageOpens(ctl, 'ctl-relink')));
	let ctlRelinkFailed = false;
	try {
		await link(ctl, await funded());
	} catch {
		ctlRelinkFailed = true;
	}
	check('Program rejects re-linking while Controlled is linked (TokenIsCurrentlyLocked)', ctlRelinkFailed);

	await send(ctlOwner, [getRemoveOwnerInstruction({ owner: ctlOwner, phygitalToken: ctlPda, ...(await getPolicyCloseAccounts(ctlPda)) })]);
	const ctlReleased = await fetchPhygitalToken(rpc, ctlPda, { commitment: 'confirmed' });
	check('Owner released it (no accessory needed)', !isPhygitalTokenLocked(ctlReleased.data) && ctlReleased.data.owner === address('11111111111111111111111111111111'), ctlReleased.data);

	const ctlNext = await funded();
	await link(ctl, ctlNext);
	const ctlRelinked = await fetchPhygitalToken(rpc, ctlPda, { commitment: 'confirmed' });
	check('After release, it links to a different wallet', ctlRelinked.data.owner === ctlNext.address, ctlRelinked.data.owner);

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
			owner: permOwner.address
		})
	]);
	const permPhone = new Browser('perm-phone');
	await permPhone.open(perm.tapUrl());
	const permView = await permPhone.get<{ accessory: { canLink: boolean; canRelease: boolean } }>('/api/accessory');
	check('App offers neither link nor release', !permView.body.accessory.canLink && !permView.body.accessory.canRelease, permView.body);
	check('The link page sends a Permanent accessory back', !(await linkPageOpens(perm, 'perm-link')));
	let permRemoveFailed = false;
	try {
		await send(permOwner, [getRemoveOwnerInstruction({ owner: permOwner, phygitalToken: permPda, ...(await getPolicyCloseAccounts(permPda)) })]);
	} catch {
		permRemoveFailed = true;
	}
	check('Program rejects release (PermanentOwnerImmutable)', permRemoveFailed);

	await prepaidFees(issuer, adminConfig);

	console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
	process.exit(failures === 0 ? 0 : 1);
}

/**
 * Needs the dev server's fee service: SPONSOR_KEYS in app/.dev.vars (funded on
 * the validator: this airdrops to them). Skipped when the service has no keys.
 */
async function prepaidFees(issuer: KeyPairSigner, adminConfig: Address) {
	console.log('\nPrepaid network fees: an owner with no SOL');
	const probe = await fetch(SPONSOR);
	const pool = probe.ok ? ((await probe.json()) as { feePayers: Address[] }).feePayers : [];
	if (pool.length === 0) {
		console.log('  – skipped: the fee service has no funded keys (set SPONSOR_KEYS in app/.dev.vars)');
		return;
	}
	const airdrop = airdropFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions('ws://127.0.0.1:8900') });
	const balanceOf = async (a: Address) => BigInt((await rpc.getBalance(a, { commitment: 'confirmed' }).send()).value);

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
			owner: address('11111111111111111111111111111111')
		})
	]);
	const [wallet] = await findWalletPda({ phygitalToken: pda });
	const [policy] = await findPolicyPda({ phygitalToken: pda });
	const start = (await prepaid(pda)).balance;
	check('A new accessory starts with 0.005 SOL of prepaid fees', start === 5_000_000n, String(start));

	const owner = await generateKeyPairSigner();
	await linkSponsored(acc, owner);
	const linked = await fetchPhygitalToken(rpc, pda, { commitment: 'confirmed' });
	check('Linked with the fee paid by Revibase', linked.data.owner === owner.address, linked.data.owner);
	check('The owner wallet still has no SOL', (await balanceOf(owner.address)) === 0n);
	const afterLink = (await prepaid(pda)).balance;
	check('The link was charged to the prepaid fees', afterLink < start && start - afterLink < 50_000n, { start: String(start), afterLink: String(afterLink) });

	await sendSponsored(pda, owner, async (feePayer) => [
		await buildPolicyInstruction(createNoopSigner(owner.address), pda, policyDiff(emptyDraft(), { ...tapPaymentsPreset(), limits: new Map([[SOL, { cap: 1_000_000n, windowSeconds: DAY_SECONDS, maxPerTx: 0n }]]) }), feePayer)
	]);
	const rent = await balanceOf(policy);
	const afterPolicy = (await prepaid(pda)).balance;
	check('Tap payments on: the fee payer funded the deposit, charged to the prepaid fees', rent > 0n && afterLink - afterPolicy >= rent, {
		rent: String(rent),
		charged: String(afterLink - afterPolicy)
	});

	const walletBefore = await balanceOf(wallet);
	await sendSponsored(pda, owner, async () => [await buildPolicyInstruction(createNoopSigner(owner.address), pda, 'close')]);
	check('Tap payments off: the deposit went to the accessory wallet', (await balanceOf(wallet)) === walletBefore + rent, String(await balanceOf(wallet)));

	const drain = await buildExecuteWithOwnerInstruction({
		owner: createNoopSigner(owner.address),
		phygitalToken: pda,
		instructions: [getTransferSolInstruction({ source: createNoopSigner(pool[0]!), destination: owner.address, amount: 1_000_000n })]
	});
	let refused = false;
	try {
		await sendSponsored(pda, owner, async () => [drain]);
	} catch {
		refused = true;
	}
	check('The fee service refuses to sign a transaction that spends its SOL', refused);

	await airdrop({ recipientAddress: wallet, lamports: lamports(20_000_000n), commitment: 'confirmed' });
	const beforeRefill = (await prepaid(pda)).balance;
	const refill = 5_000_000n - beforeRefill + 50_000n;
	await sendSponsored(pda, owner, async (feePayer) => [await buildRefillInstruction(createNoopSigner(owner.address), pda, feePayer.address, refill)]);
	const afterRefill = (await prepaid(pda)).balance;
	check('A refill from the accessory wallet brings the prepaid fees back to about 0.005 SOL', afterRefill > 4_990_000n && afterRefill <= 5_050_000n, String(afterRefill));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
