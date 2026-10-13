/**
 * Dev helper: persistent software accessories on the local validator, so the
 * UI can be exercised in a browser without hardware.
 *
 *   pnpm dev:accessory init                          # AdminConfig + issuer (fresh validator)
 *   pnpm dev:accessory add <name> [bearer|controlled|permanent]
 *   pnpm dev:accessory tap <name>                    # print a fresh NFC tap URL
 *   pnpm dev:accessory link <name>                   # full link ceremony via the API to a new funded wallet
 *   pnpm dev:accessory mint <name> [mintAddress]     # bind a mint (assign_mint) — random address if omitted
 *
 * Keys live in scripts/.dev-accessory.json (gitignored, local validator only).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { address, generateKeyPairSigner } from '@solana/kit';
import { getAssignMintInstructionAsync } from 'phygital-token-sdk';

import { base64UrlToBytes, bytesToBase64Url } from '../src/lib/shared/encoding';
import { createAdmin, fakeAccessory, funded, issueAccessory, link, send, type AccessoryKeys, type AccessoryKind } from './lib';

const STATE = new URL('./.dev-accessory.json', import.meta.url);
type State = { issuer: string; minter?: string; accessories: Record<string, { keys: AccessoryKeys; pda: string; kind: string }> };
const load = (): State => {
	if (!existsSync(STATE)) throw new Error('Run `pnpm dev:accessory init` first.');
	return JSON.parse(readFileSync(STATE, 'utf8'));
};
const save = (s: State) => writeFileSync(STATE, JSON.stringify(s, null, 2));
async function init() {
	const { issuerKey, minterKey, issuer } = await createAdmin();
	save({ issuer: bytesToBase64Url(issuerKey), minter: bytesToBase64Url(minterKey), accessories: {} });
	console.log(`issuer ${issuer} ready`);
}

async function add(name: string, kind = 'bearer') {
	const s = load();
	const { acc, pda } = await issueAccessory(base64UrlToBytes(s.issuer), kind as AccessoryKind);
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

async function tapAndLink(acc: ReturnType<typeof fakeAccessory>) {
	const owner = await funded();
	await link(acc, owner);
	return owner.address;
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
	link: withAccessory(name, async (acc) => console.log(`linked to ${await tapAndLink(acc)}`))
};
const run = commands[cmd];
if (!run || (cmd !== 'init' && !name)) {
	console.log('usage: dev-accessory init | add <name> [bearer|controlled|permanent] | tap <name> | link <name> | mint <name> [mint]');
	process.exit(1);
}
run().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});
