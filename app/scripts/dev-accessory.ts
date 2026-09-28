/**
 * Dev helper: persistent software accessories on the local validator, so the
 * UI can be exercised in a browser without hardware.
 *
 *   pnpm dev:accessory init                          # AdminConfig + issuer (fresh validator)
 *   pnpm dev:accessory add <name> [bearer|controlled|permanent]
 *   pnpm dev:accessory tap <name>                    # print a fresh NFC tap URL
 *   pnpm dev:accessory link <name>                   # full link ceremony via the API to a new funded wallet
 *   pnpm dev:accessory handoff <name>                # tap + approve on a scripted phone; print the /continue link
 *   pnpm dev:accessory mint <name> [mintAddress]     # bind a mint (assign_mint) — random address if omitted
 *
 * Keys live in scripts/.dev-accessory.json (gitignored, local validator only).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { address, generateKeyPairSigner } from '@solana/kit';
import {
	findAdminConfigPda,
	findPhygitalTokenPda,
	getCreateConfigInstructionAsync,
	getInitializeInstructionAsync,
	getAssignMintInstructionAsync,
	getSetIssuerInstructionAsync,
	getSetMinterInstructionAsync,
	PhygitalTokenType
} from 'phygital-token-sdk';

import { base64UrlToBytes, bytesToBase64Url } from '../src/lib/shared/encoding';
import type { LinkStatusView, TransferChallenge } from '../src/lib/shared/types';
import { Browser, fakeAccessory, finish, funded, rpc, send, type AccessoryKeys } from './lib';

const STATE = new URL('./.dev-accessory.json', import.meta.url);
type State = { issuer: string; minter?: string; accessories: Record<string, { keys: AccessoryKeys; pda: string; kind: string }> };
const load = (): State => {
	if (!existsSync(STATE)) throw new Error('Run `pnpm dev:accessory init` first.');
	return JSON.parse(readFileSync(STATE, 'utf8'));
};
const save = (s: State) => writeFileSync(STATE, JSON.stringify(s, null, 2));
const UNSET = address('11111111111111111111111111111111');

async function init() {
	const [adminConfig] = await findAdminConfigPda();
	if ((await rpc.getAccountInfo(adminConfig, { encoding: 'base64' }).send()).value) {
		throw new Error('AdminConfig already exists; restart the validator with --reset first.');
	}
	const admin = await funded();
	const issuerKey = crypto.getRandomValues(new Uint8Array(32));
	const issuer = await funded(issuerKey);
	await send(admin, [await getCreateConfigInstructionAsync({ authority: admin })]);
	await send(admin, [await getSetIssuerInstructionAsync({ admin, issuer: issuer.address })]);
	const minterKey = crypto.getRandomValues(new Uint8Array(32));
	const minter = await funded(minterKey);
	await send(admin, [await getSetMinterInstructionAsync({ admin, minter: minter.address })]);
	save({ issuer: bytesToBase64Url(issuerKey), minter: bytesToBase64Url(minterKey), accessories: {} });
	console.log(`issuer ${issuer.address} ready`);
}

async function add(name: string, kind = 'bearer') {
	const s = load();
	const issuer = await funded(base64UrlToBytes(s.issuer));
	const [adminConfig] = await findAdminConfigPda();
	const acc = fakeAccessory();
	const pda = await findPhygitalTokenPda([acc.passkey]);
	const tokenType = { bearer: PhygitalTokenType.Bearer, controlled: PhygitalTokenType.Controlled, permanent: PhygitalTokenType.Permanent }[kind];
	if (tokenType === undefined) throw new Error(`unknown type ${kind}`);
	// Permanent must name its wallet at initialize.
	const linkedWallet = tokenType === PhygitalTokenType.Permanent ? (await funded()).address : UNSET;
	await send(issuer, [
		await getInitializeInstructionAsync({
			authority: issuer,
			adminConfig,
			phygitalToken: pda,
			identifier: [acc.identifier],
			secp256r1Pubkey: [acc.passkey],
			tokenType,
			linkedWallet
		})
	]);
	s.accessories[name] = { keys: acc.keys(), pda: String(pda), kind };
	save(s);
	console.log(`${kind} accessory "${name}" → ${pda}`);
}

function withAccessory<T>(name: string, fn: (acc: ReturnType<typeof fakeAccessory>) => Promise<T>) {
	return async () => {
		const s = load();
		const entry = s.accessories[name];
		if (!entry) throw new Error(`no accessory "${name}"`);
		const acc = fakeAccessory(entry.keys);
		try {
			return await fn(acc);
		} finally {
			entry.keys = acc.keys();
			save(s);
		}
	};
}

async function tapThenApprove(acc: ReturnType<typeof fakeAccessory>) {
	const phone = new Browser('phone');
	await phone.open(acc.tapUrl());
	const start = await phone.post<LinkStatusView & { error?: string }>('/api/link');
	if (start.status !== 200) throw new Error(`cannot link: ${start.body.error}`);
	const ch = await phone.post<TransferChallenge>(`/api/link/${start.body.id}/challenge`);
	const res = await phone.post<{ handoffUrl: string }>(`/api/link/${start.body.id}/assertion`, {
		response: acc.webauthn(ch.body.challenge)
	});
	return { linkId: start.body.id, handoffUrl: res.body.handoffUrl };
}

async function bindMint(name: string, mintArg?: string) {
	const s = load();
	const entry = s.accessories[name];
	if (!entry) throw new Error(`no accessory "${name}"`);
	if (!s.minter) throw new Error('no minter saved; re-run init on a fresh validator');
	const minter = await funded(base64UrlToBytes(s.minter));
	const mint = mintArg ? address(mintArg) : (await generateKeyPairSigner()).address;
	await send(minter, [await getAssignMintInstructionAsync({ authority: minter, phygitalToken: address(entry.pda), mint })]);
	console.log(mint);
}

const [cmd, name, arg] = process.argv.slice(2);
const commands: Record<string, () => Promise<unknown>> = {
	init,
	add: () => add(name, arg),
	mint: () => bindMint(name, arg),
	tap: withAccessory(name, async (acc) => console.log(acc.tapUrl())),
	handoff: withAccessory(name, async (acc) => console.log((await tapThenApprove(acc)).handoffUrl)),
	link: withAccessory(name, async (acc) => {
		const { handoffUrl, linkId } = await tapThenApprove(acc);
		const wallet = new Browser('wallet');
		await wallet.post('/api/handoff/claim', { h: new URL(handoffUrl).hash.replace('#h=', '') });
		const owner = await funded();
		await finish(wallet, linkId, owner);
		console.log(`linked to ${owner.address}`);
	})
};
const run = commands[cmd];
if (!run || (cmd !== 'init' && !name)) {
	console.log('usage: dev-accessory init | add <name> [bearer|controlled|permanent] | tap <name> | link <name> | handoff <name> | mint <name> [mint]');
	process.exit(1);
}
run().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});
