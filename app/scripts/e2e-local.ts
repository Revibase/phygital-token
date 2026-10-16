/** Local direct-browser claim and on-chain accessory checks. */
import { address } from '@solana/kit';
import {
	fetchPhygitalToken,
	findAdminConfigPda,
	findPhygitalTokenPda,
	getCreateConfigInstructionAsync,
	getInitializeInstructionAsync,
	getRemoveOwnerInstruction,
	getSetIssuerInstructionAsync,
	isPhygitalTokenLocked,
	PhygitalTokenType
} from 'phygital-token-sdk';

import {
	APP,
	Browser,
	check,
	failures,
	fakeAccessory,
	finishDirectly,
	funded,
	rpc,
	send
} from './lib';

async function initialize(
	issuer: Awaited<ReturnType<typeof funded>>,
	adminConfig: Awaited<ReturnType<typeof findAdminConfigPda>>[0],
	acc: ReturnType<typeof fakeAccessory>,
	tokenType: PhygitalTokenType,
	owner: string
) {
	const pda = await findPhygitalTokenPda([acc.passkey]);
	await send(issuer, [
		await getInitializeInstructionAsync({
			authority: issuer,
			adminConfig,
			phygitalToken: pda,
			identifier: [acc.identifier],
			secp256r1Pubkey: [acc.passkey],
			tokenType,
			owner: address(owner)
		})
	]);
	return pda;
}

async function main() {
	console.log(`Direct browser claim against ${APP} + local validator`);
	const admin = await funded();
	const issuer = await funded();
	const [adminConfig] = await findAdminConfigPda();
	if ((await rpc.getAccountInfo(adminConfig, { encoding: 'base64' }).send()).value) {
		throw new Error('AdminConfig already exists; restart solana-test-validator with --reset.');
	}
	await send(admin, [await getCreateConfigInstructionAsync({ authority: admin })]);
	await send(admin, [await getSetIssuerInstructionAsync({ admin, issuer: issuer.address })]);

	const acc = fakeAccessory();
	const pda = await initialize(
		issuer,
		adminConfig,
		acc,
		PhygitalTokenType.Bearer,
		'11111111111111111111111111111111'
	);
	const tapBrowser = new Browser('tap browser');
	const tap = await tapBrowser.open(acc.tapUrl());
	check('NFC tap opens the accessory in this browser', tap.status === 303, tap);
	const owner = await funded();
	await finishDirectly(acc, owner);
	const linked = await fetchPhygitalToken(rpc, pda, { commitment: 'confirmed' });
	check(
		'Browser-built WebAuthn transaction assigns the owner',
		linked.data.owner === owner.address
	);

	const controlled = fakeAccessory();
	const controlledPda = await initialize(
		issuer,
		adminConfig,
		controlled,
		PhygitalTokenType.Controlled,
		'11111111111111111111111111111111'
	);
	const controlledOwner = await funded();
	await finishDirectly(controlled, controlledOwner);
	const locked = await fetchPhygitalToken(rpc, controlledPda, { commitment: 'confirmed' });
	check(
		'Controlled accessory is locked to the claimed owner',
		locked.data.owner === controlledOwner.address && isPhygitalTokenLocked(locked.data)
	);
	const controlledBrowser = new Browser('controlled accessory');
	await controlledBrowser.open(controlled.tapUrl());
	const view = await controlledBrowser.get<{
		accessory: { canLink: boolean; canRelease: boolean };
	}>('/api/accessory');
	check(
		'App offers release and prevents relinking while locked',
		!view.body.accessory.canLink && view.body.accessory.canRelease
	);
	await send(controlledOwner, [
		getRemoveOwnerInstruction({
			owner: controlledOwner,
			phygitalToken: controlledPda
		})
	]);
	const released = await fetchPhygitalToken(rpc, controlledPda, { commitment: 'confirmed' });
	check('Owner can release a controlled accessory', !isPhygitalTokenLocked(released.data));
	const nextOwner = await funded();
	await finishDirectly(controlled, nextOwner);
	const relinked = await fetchPhygitalToken(rpc, controlledPda, { commitment: 'confirmed' });
	check(
		'Released accessory can be claimed by another wallet',
		relinked.data.owner === nextOwner.address
	);

	const permanent = fakeAccessory();
	const permanentOwner = await funded();
	const permanentPda = await initialize(
		issuer,
		adminConfig,
		permanent,
		PhygitalTokenType.Permanent,
		String(permanentOwner.address)
	);
	const permanentBrowser = new Browser('permanent accessory');
	await permanentBrowser.open(permanent.tapUrl());
	const permanentView = await permanentBrowser.get<{
		accessory: { canLink: boolean; canRelease: boolean };
	}>('/api/accessory');
	check(
		'Permanent accessory offers neither claim nor release',
		!permanentView.body.accessory.canLink && !permanentView.body.accessory.canRelease
	);
	let releaseFailed = false;
	try {
		await send(permanentOwner, [
			getRemoveOwnerInstruction({
				owner: permanentOwner,
				phygitalToken: permanentPda
			})
		]);
	} catch {
		releaseFailed = true;
	}
	check('Program rejects releasing a permanent accessory', releaseFailed);

	console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
