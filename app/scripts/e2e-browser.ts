/**
 * End-to-end browser run against the real app, the real signer iframe and a
 * local validator, with WebAuthn served by a virtual authenticator (see
 * test/e2e/webauthn-bridge.ts). Setup is in scripts/e2e-setup.ts.
 *
 *   E2E_ENGINE=webkit   run in WebKit instead of system Chrome
 *   E2E_FILTER=regex    run matching scenarios only
 *   E2E_HEADED=1        show the browser
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, webkit, type BrowserContext, type FrameLocator, type Page } from 'playwright';
import { createServer as createVite } from 'vite';

import { address, generateKeyPairSigner, lamports, type Address } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
	findAssociatedTokenPda,
	getCreateAssociatedTokenIdempotentInstructionAsync,
	getInitializeMint2Instruction,
	getMintSize,
	getMintToInstruction,
	TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';
import { encodePermissionRequest, fetchMaybeAccessoryPolicy, fetchMaybePhygitalToken, findPolicyPda, findWalletPda } from 'phygital-token-sdk';

import { base64UrlToBytes } from '../src/lib/shared/encoding';
import { LeakScanner } from 'secure-signer/testing/kit';
import { doubleVerifyWire, durableNonceWire, foreignProgramWire, lookupTableWire, opaqueExecuteWire, removeOwnerWire, toB64 } from 'secure-signer/testing/tx-fixtures';
import { WebAuthnBridge } from '../test/e2e/webauthn-bridge';
import { funded, issueAccessory, rpc, send, type AccessoryKind } from './lib';

const APP = 'https://localhost:5173';
const SIGNER = 'https://localhost:5174';
/** An integrator's site on its own origin, for tap-to-sign and allowed-site checks. */
const DAPP = 'https://localhost:4300';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36';

const engine = process.env.E2E_ENGINE === 'webkit' ? 'webkit' : 'chrome';
const results = new URL('../test/e2e/results/', import.meta.url);
mkdirSync(results, { recursive: true });

for (const [url, what] of [
	[APP, 'the app (REVIBASE_PLATFORM=e2e pnpm dev)'],
	[SIGNER, 'the signer (pnpm --filter secure-signer exec vite --mode e2e)']
]) {
	const ok = await fetch(url).then((r) => r.ok, () => false);
	assert.ok(ok, `Start ${what} before the e2e run`);
}

type Stack = { issuer: string; accessories: Record<string, { kind: string; pda: string; keys: { fidoKey: string; ndefKey: string; counter: number; signCount: number } }> };
export const stack: Stack = JSON.parse(readFileSync(new URL('../.wrangler/e2e/state.json', import.meta.url), 'utf8'));

const dapp = await createVite({
	configFile: false,
	root: new URL('../test/e2e/dapp/', import.meta.url).pathname,
	// Its own pre-bundle cache: sharing the app's node_modules/.vite would invalidate the app server's.
	cacheDir: new URL('../.wrangler/e2e/vite-dapp/', import.meta.url).pathname,
	define: { 'process.env.NODE_ENV': '"development"' },
	server: {
		port: 4300,
		strictPort: true,
		hmr: false,
		https: { cert: readFileSync(new URL('../.wrangler/e2e/tls/cert.pem', import.meta.url)), key: readFileSync(new URL('../.wrangler/e2e/tls/key.pem', import.meta.url)) }
	},
	logLevel: 'warn'
});
await dapp.listen();
// Pre-bundle its dependencies now: on a cold cache the first page load would otherwise stall a scenario.
await dapp.warmupRequest('/main.ts').catch(() => {});
await fetch(DAPP + '/main.ts').catch(() => {});

const browser = engine === 'webkit' ? await webkit.launch({ headless: !process.env.E2E_HEADED }) : await chromium.launch({ channel: 'chrome', headless: !process.env.E2E_HEADED });

const outcomes: { name: string; status: 'passed' | 'failed'; error?: string }[] = [];
const pageErrors: string[] = [];

export type Session = {
	context: BrowserContext;
	page: Page;
	bridge: WebAuthnBridge;
	signer: FrameLocator;
	log: string[];
	/** Everything that crossed out of the signer: messages to the app and every request body. */
	crossed: { where: string; value: string }[];
};

/** A browser on one phone; pass another session's bridge for a second phone with the same synced passkeys. */
async function session(bridge = new WebAuthnBridge()): Promise<Session> {
	const context = await browser.newContext({
		userAgent: engine === 'webkit' ? IOS : ANDROID,
		viewport: { width: 390, height: 844 },
		ignoreHTTPSErrors: true,
		isMobile: engine !== 'webkit',
		hasTouch: true
	});
	await bridge.install(context);
	const crossed: Session['crossed'] = [];
	await context.exposeBinding('__signerPosted', ({ frame }, data: string) => {
		if (frame === frame.page().mainFrame()) crossed.push({ where: 'signer → app message', value: data });
	});
	await context.addInitScript(`window.addEventListener('message', (e) => {
		if (window === window.top && e.origin === ${JSON.stringify(SIGNER)}) window.__signerPosted(JSON.stringify(e.data));
	});`);
	context.on('request', (r) => {
		const body = r.postData();
		if (body) crossed.push({ where: `${r.method()} ${r.url().split('?')[0]}`, value: body });
	});
	const page = await context.newPage();
	const log: string[] = [];
	page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e}`));
	page.on('console', (m) => m.type() === 'error' && log.push(`console: ${m.text().slice(0, 300)}`));
	page.on('response', async (r) => {
		if (!r.url().includes(':8899')) return;
		const body = await r.text().catch(() => '');
		if (process.env.E2E_TRACE) log.push(`rpc ${r.request().postDataJSON()?.method} ${r.status()} ${body.length}b`);
		// The local validator has no DAS index; holdings fall back without it.
		if (body.includes('wallet-getAssetsByOwner')) return;
		if (r.status() >= 400 || body.includes('"error"')) log.push(`rpc ${r.request().postDataJSON()?.method}: ${body.slice(0, 300)}`);
	});
	return { context, page, bridge, signer: page.frameLocator('iframe[title="Revibase Passkey"]'), log, crossed };
}

async function test(name: string, fn: (s: Session, another: (bridge?: WebAuthnBridge) => Promise<Session>) => Promise<void>) {
	if (process.env.E2E_FILTER && !new RegExp(process.env.E2E_FILTER).test(name)) return;
	const s = await session();
	const extra: Session[] = [];
	try {
		await fn(s, async (bridge) => {
			const next = await session(bridge);
			extra.push(next);
			return next;
		});
		await assertNoLeaks([s, ...extra]);
		outcomes.push({ name, status: 'passed' });
		console.log(`PASS ${name}`);
	} catch (e) {
		outcomes.push({ name, status: 'failed', error: String(e) });
		console.error(`FAIL ${name}: ${e}`);
		await s.page.screenshot({ path: new URL(`fail-${name.replace(/\W+/g, '-')}.png`, results).pathname }).catch(() => {});
		console.log('  ceremonies', JSON.stringify(s.bridge.ceremonies));
		for (const line of [...s.log, ...extra.flatMap((x) => x.log)].slice(process.env.E2E_TRACE ? -60 : -15)) console.log('  ' + line);
	} finally {
		for (const x of [s, ...extra]) await x.context.close();
	}
}

/**
 * In-page source (not a closure: tsx would inject helpers the page lacks):
 * posts one message to the signer frame as script on the app origin could,
 * and resolves with the signer's reply, or NO_REPLY.
 */
const ASK_SIGNER = `async ([m, origin, stamp]) => {
	const frame = document.querySelector('iframe[title="Revibase Passkey"]').contentWindow;
	const id = m.requestId ?? crypto.randomUUID().replaceAll('-', '');
	const full = stamp ? { protocolVersion: 1, timestamp: Date.now(), ...m, requestId: id } : { ...m, requestId: id };
	return await new Promise((resolve) => {
		let on;
		const timer = setTimeout(() => { removeEventListener('message', on); resolve({ type: 'NO_REPLY' }); }, 4000);
		on = (e) => {
			if (e.origin !== origin || e.data?.requestId !== id) return;
			clearTimeout(timer);
			removeEventListener('message', on);
			resolve(e.data);
		};
		addEventListener('message', on);
		frame.postMessage(full, origin);
	});
}`;

/** Opens the accessory wallet page, past its first-visit intro. */
async function openWallet(page: Page, pda: string) {
	await open(page, `/wallet/${pda}`);
	const gotIt = page.getByRole('button', { name: 'Got it' });
	if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}

/** Navigates and waits for hydration, so the first click isn't lost. */
async function open(page: Page, path: string) {
	await page.goto(APP + path);
	await page.waitForLoadState('networkidle');
}

/**
 * PRF outputs wrap the wallet key: they may exist only inside the signer
 * origin. Nothing posted to the app, sent over the network or stored by the
 * app may contain one, in any encoding.
 */
async function assertNoLeaks(sessions: Session[]) {
	const scanner = new LeakScanner();
	sessions.flatMap((x) => x.bridge.prfOutputs).forEach((out, i) => scanner.track(`prf-${i}`, out));
	const items = sessions.flatMap((x) => x.crossed);
	for (const x of sessions) {
		if (x.page.isClosed()) continue;
		const storage = await x.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie })).catch(() => '');
		items.push({ where: 'app storage', value: storage });
	}
	const findings = scanner.scanAll(items);
	assert.equal(findings.length, 0, `secret material crossed the signer boundary: ${JSON.stringify(findings.slice(0, 3))}`);
	assert.ok(sessions.every((x) => x.bridge.prfOutputs.length === 0) || items.length > 0, 'the leak scan saw traffic');
}

const text = (scope: Page | FrameLocator, value: string | RegExp) => scope.getByText(value, { exact: typeof value === 'string' }).first();

const screens = new URL('signer/', results);
mkdirSync(screens, { recursive: true });
/** Saves the signer's current screen for the readability review. */
async function capture({ page }: Session, name: string) {
	await page.locator('iframe[title="Revibase Passkey"]').screenshot({ path: new URL(`${engine}-${name}.png`, screens).pathname });
}

/** A fresh software accessory, issued on chain for one scenario. */
async function issue(kind: AccessoryKind) {
	const { acc, pda } = await issueAccessory(base64UrlToBytes(stack.issuer), kind);
	return { acc, pda: String(pda) };
}
type Accessory = Awaited<ReturnType<typeof issue>>;

/** A signed NFC tap: the server checks it and starts this browser's tap session. */
async function tapIn({ page }: Session, accessory: Accessory) {
	await page.goto(accessory.acc.tapUrl());
	await page.waitForLoadState('networkidle');
}

const ownerOf = async (pda: string) => {
	const token = await fetchMaybePhygitalToken(rpc, address(pda), { commitment: 'confirmed' });
	assert.ok(token.exists, 'accessory exists');
	return String(token.data.owner);
};

const walletOf = async (pda: string) => String((await findWalletPda({ phygitalToken: address(pda) }))[0]);
const balance = async (account: string) => (await rpc.getBalance(address(account), { commitment: 'confirmed' }).send()).value;
const tokenBalance = async (owner: string, mint: Address) => {
	const [ata] = await findAssociatedTokenPda({ owner: address(owner), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
	const info = await rpc.getTokenAccountBalance(ata, { commitment: 'confirmed' }).send().catch(() => null);
	return info ? BigInt(info.value.amount) : 0n;
};

/** Sends SOL to an address from a funded test payer. */
async function fund(to: string, sol: number) {
	const payer = await funded();
	const { getTransferSolInstruction } = await import('@solana-program/system');
	await send(payer, [getTransferSolInstruction({ source: payer, destination: address(to), amount: lamports(BigInt(Math.round(sol * 1e9))) })]);
}

/** A new SPL mint (6 decimals) with `amount` raw units minted to `owner`'s ATA. */
async function mintTo(owner: string, amount: bigint) {
	const payer = await funded();
	const mint = await generateKeyPairSigner();
	const space = BigInt(getMintSize());
	const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
	const [ata] = await findAssociatedTokenPda({ owner: address(owner), mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
	await send(payer, [
		getCreateAccountInstruction({ payer, newAccount: mint, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
		getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: payer.address }),
		await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: address(owner), mint: mint.address }),
		getMintToInstruction({ mint: mint.address, token: ata, mintAuthority: payer, amount })
	]);
	return mint.address;
}

/** Claims a fresh accessory with a new passkey wallet; returns it with both wallet addresses. */
async function claimed(s: Session, kind: AccessoryKind = 'controlled') {
	const accessory = await issue(kind);
	await tapIn(s, accessory);
	await claim(s, accessory);
	return { ...accessory, owner: (await passkeyAddress(s.page))!, wallet: await walletOf(accessory.pda) };
}

/** The owner allows System transfers by tap: 0.1 SOL a day, at most 0.01 SOL per tap. */
async function allowTapPayments(s: Session, origins: string[] = [DAPP]) {
	const link = await encodePermissionRequest(
		{
			v: 1,
			name: 'E2E payments',
			reason: 'Send small SOL payments with a tap.',
			programs: [{ id: '11111111111111111111111111111111', access: { only: [{ selector: '02000000' }] } }],
			limits: [{ asset: 'SOL', amount: '100000000', period: 'day', maxPerTap: '10000000' }],
			origins
		},
		APP + '/permissions'
	);
	await s.page.goto(link);
	await s.page.waitForLoadState('networkidle');
	await s.page.getByRole('button', { name: 'Allow these permissions' }).click();
	await authorize(s, 'update-policy-request');
	await text(s.page, 'Tap permissions saved').waitFor({ timeout: 60_000 });
}

type DappOutcome = { ok: true; signature: string } | { ok: false; name: string; code?: string; message: string };
/** Pays from the accessory wallet on the integrator's site, holding the accessory to the phone. */
async function payOnDapp(s: Session, accessory: Accessory, recipient: string, lamports: bigint, call: 'pay' | 'memo' = 'pay') {
	const page = await s.context.newPage();
	await page.goto(DAPP + '/');
	await page.getByText('loaded').waitFor({ timeout: 90_000 });
	s.bridge.holdAccessory(accessory.acc.fidoKey);
	const outcome = await page.evaluate(
		([fn, pda, to, amount]) => (window as unknown as { dapp: Record<string, (...a: string[]) => Promise<unknown>> }).dapp[fn](pda, to, amount),
		[call, accessory.pda, recipient, String(lamports)] as const
	);
	s.bridge.releaseAccessory();
	await page.close();
	return outcome as DappOutcome;
}

/** The passkey wallet address this browser remembers. */
const passkeyAddress = (page: Page) => page.evaluate(() => localStorage.getItem('revibase:signer:account'));

/** Picks Revibase Passkey in an open wallet list; creates the passkey wallet on first use. */
async function pickPasskeyWallet({ page, signer }: Session, mode: 'create' | 'existing' = 'create') {
	const passkey = page.getByRole('button', { name: /Revibase Passkey/ });
	if (!(await passkey.isVisible())) await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
	await passkey.click();
	if (mode === 'create') {
		await page.getByRole('button', { name: 'Create a new passkey wallet' }).click();
		await signer.getByRole('button', { name: 'Confirm' }).click();
	} else {
		await page.getByRole('button', { name: 'I already have one' }).click();
		await signer.getByRole('button', { name: 'Unlock' }).click();
	}
}

/** Approves the transaction on the signer's confirm screen, saving it for review first. */
async function authorize(s: Session, screen: string) {
	const button = s.signer.getByRole('button', { name: /^Authorize/ });
	await button.waitFor({ timeout: 30_000 });
	await capture(s, screen);
	await button.click();
}

/** Claims an accessory the browser has tapped, with the passkey wallet. */
async function claim(s: Session, accessory: Accessory, wallet: 'create' | 'existing' = 'create') {
	const { page, bridge } = s;
	await page.getByRole('link', { name: /Claim/ }).first().click();
	await text(page, 'Approve with your accessory').waitFor();
	bridge.holdAccessory(accessory.acc.fidoKey);
	await page.getByRole('button', { name: 'Approve', exact: true }).click();
	await pickPasskeyWallet(s, wallet);
	await page.getByRole('button', { name: /^Claim/ }).click();
	await authorize(s, 'link-accessory');
	await text(page, 'Accessory claimed').waitFor({ timeout: 60_000 });
	bridge.releaseAccessory();
}

/** Connects the Revibase Passkey wallet from the home page, creating a new passkey. */
async function createPasskeyWallet({ page, signer, bridge }: Session) {
	await open(page, '/');
	await pickPasskeyWallet({ page, signer, bridge } as Session);
	// Connecting from home logs the browser in with one sign-in message.
	await signer.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.locator('iframe[title="Revibase Passkey"]').waitFor({ state: 'attached' });
	await text(page, 'Your accessories').waitFor({ timeout: 30_000 });
	await page.waitForFunction(() => !document.querySelector('[aria-label="Cancel"].fixed'));
	const passkey = bridge.passkeys().at(-1);
	assert.ok(passkey, 'a passkey was created');
	return passkey;
}

try {
	await test('passkey wallet: create through the signer iframe', async (s) => {
		await createPasskeyWallet(s);
		const create = s.bridge.ceremonies.find((c) => c.op === 'create');
		assert.equal(create?.origin, APP, 'the passkey is created on the app origin');
		assert.equal(create?.topOrigin, undefined);
		const enrol = s.bridge.ceremonies.find((c) => c.op === 'get' && c.ok);
		assert.equal(enrol?.origin, SIGNER, 'the signer frame unwraps with PRF on its own origin');
		assert.equal(enrol?.topOrigin, APP);
		const allow = await s.page.locator('iframe[title="Revibase Passkey"]').getAttribute('allow');
		assert.equal(allow, `publickey-credentials-get ${SIGNER}; clipboard-write ${SIGNER}`, 'the frame is delegated WebAuthn for its own origin only');
	});

	await test('claim: tap, passkey wallet, signer approval, owner on chain', async (s) => {
		const accessory = await issue('controlled');
		await tapIn(s, accessory);
		await claim(s, accessory);
		const wallet = await passkeyAddress(s.page);
		assert.ok(wallet, 'the passkey wallet is remembered');
		assert.equal(await ownerOf(accessory.pda), wallet, 'the passkey wallet owns the accessory on chain');
		const tap = s.bridge.ceremonies.find((c) => c.nfc);
		assert.ok(tap?.ok && tap.origin === APP && !tap.topOrigin, 'the accessory tap ran top-level on the app');
	});

	await test('owner login: opening an owned accessory signs in once through the signer', async (s) => {
		const accessory = await issue('controlled');
		await tapIn(s, accessory);
		await claim(s, accessory);
		await s.context.clearCookies({ name: 'bu' });
		await open(s.page, '/');
		await s.page.getByRole('button', { name: /^Accessory ·/ }).click();
		const signIn = s.signer.getByRole('button', { name: 'Sign in', exact: true });
		await signIn.waitFor({ timeout: 30_000 });
		await capture(s, 'sign-in-message');
		const shown = await s.signer.locator('.sign-message').innerText();
		const wallet = await passkeyAddress(s.page);
		assert.match(shown, /^localhost:5173 wants you to sign in with your Solana account:\n/, 'the message names the app');
		assert.equal(shown.split('\n')[1], wallet, 'and this wallet');
		await signIn.click();
		await s.page.waitForURL(APP + '/accessory');
		await text(s.page, 'Owner').waitFor();
		const cookies = (await s.context.cookies(APP)).map((c) => c.name);
		assert.ok(cookies.some((n) => n.endsWith('os')), 'the owner session cookie is set');
	});

	await test('new phone: the same passkey restores the wallet from backup', async (s, another) => {
		await createPasskeyWallet(s);
		const wallet = await passkeyAddress(s.page);
		const phone = await another(s.bridge);
		await open(phone.page, '/');
		await pickPasskeyWallet(phone, 'existing');
		await phone.signer.getByRole('button', { name: 'Sign in', exact: true }).click();
		await text(phone.page, 'Your accessories').waitFor({ timeout: 30_000 });
		assert.equal(await passkeyAddress(phone.page), wallet, 'the restored wallet has the same address');
		const restore = phone.bridge.ceremonies.at(-1);
		assert.ok(restore?.ok && restore.origin === SIGNER && restore.topOrigin === APP, 'restored by a discoverable get in the signer frame');
	});

	await test('unknown passkey: restoring with no backup offers to create a wallet', async (s) => {
		await open(s.page, '/');
		await pickPasskeyWallet(s, 'existing');
		await text(s.page, 'Can’t find your passkey wallet').waitFor({ timeout: 30_000 });
		assert.equal(await passkeyAddress(s.page), null, 'nothing is connected');
	});

	await test('permission request: update_policy through the signer, read back on chain', async (s) => {
		const accessory = await claimed(s);
		const link = await encodePermissionRequest(
			{
				v: 1,
				name: 'E2E payments',
				reason: 'Send small SOL payments with a tap.',
				programs: [{ id: '11111111111111111111111111111111', access: { only: [{ selector: '02000000' }] } }],
				limits: [{ asset: 'SOL', amount: '100000000', period: 'day', maxPerTap: '10000000' }],
				origins: [DAPP]
			},
			APP + '/permissions'
		);
		await s.page.goto(link);
		await s.page.waitForLoadState('networkidle');
		await s.page.getByRole('button', { name: 'Allow these permissions' }).click();
		await authorize(s, 'update-policy-request');
		await text(s.page, 'Tap permissions saved').waitFor({ timeout: 60_000 });
		const [policyPda] = await findPolicyPda({ phygitalToken: address(accessory.pda) });
		const policy = await fetchMaybeAccessoryPolicy(rpc, policyPda, { commitment: 'confirmed' });
		assert.ok(policy.exists, 'the policy exists on chain');
		assert.equal(policy.data.solCap.__option, 'Some');
		// No site list yet means any site; a request's origins only add to an existing list.
		assert.deepEqual(policy.data.allowedOrigins, []);
		assert.equal(policy.data.programPermissions.length, 1);
	});

	await test('send SOL: the confirm screen shows amount and recipient, funds arrive', async (s) => {
		const accessory = await claimed(s);
		await fund(accessory.wallet, 1);
		const recipient = (await generateKeyPairSigner()).address;
		await openWallet(s.page, accessory.pda);
		await s.page.getByRole('button', { name: /^Solana SOL/ }).click();
		await s.page.getByLabel('Send to').fill(recipient);
		await s.page.getByLabel('Amount').fill('0.25');
		await s.page.getByRole('button', { name: /^Send/ }).last().click();
		await authorize(s, 'send-sol');
		await text(s.page, 'SOL sent').waitFor({ timeout: 60_000 });
		assert.equal(await balance(recipient), 250_000_000n, 'the recipient received exactly 0.25 SOL');
	});

	await test('send token: TransferChecked to a new account, shown with its amount', async (s) => {
		const accessory = await claimed(s);
		await fund(accessory.wallet, 0.1);
		const mint = await mintTo(accessory.wallet, 5_000_000n);
		const recipient = (await generateKeyPairSigner()).address;
		await openWallet(s.page, accessory.pda);
		await s.page.getByRole('button', { name: new RegExp(mint.slice(0, 4)) }).click();
		await s.page.getByLabel('Send to').fill(recipient);
		await s.page.getByLabel('Amount').fill('1.5');
		await s.page.getByRole('button', { name: /^Send/ }).last().click();
		await authorize(s, 'send-token');
		await s.page.getByText(/^Sent 1\.5/).waitFor({ timeout: 60_000 });
		assert.equal(await tokenBalance(recipient, mint), 1_500_000n, 'the recipient received 1.5 tokens');
	});

	await test('send all: SOL and tokens move to the owner', async (s) => {
		const accessory = await claimed(s);
		await fund(accessory.wallet, 0.5);
		const mint = await mintTo(accessory.wallet, 2_000_000n);
		await openWallet(s.page, accessory.pda);
		await s.page.getByRole('button', { name: /Send all/ }).click();
		await s.page.getByRole('button', { name: /^Send \d+ assets? to owner/ }).click();
		// Each batch needs its own approval; done when the owner holds everything (the toast is brief).
		const next = s.signer.getByRole('button', { name: /^Authorize/ });
		const deadline = Date.now() + 120_000;
		for (let approvals = 0; (await tokenBalance(accessory.owner, mint)) !== 2_000_000n || (await balance(accessory.wallet)) > 0n; ) {
			if (Date.now() > deadline) throw new Error('send all never finished');
			if (await next.isVisible().catch(() => false)) {
				if (++approvals > 5) throw new Error('too many approvals');
				await authorize(s, `send-all-${approvals}`);
			}
			await s.page.waitForTimeout(500);
		}
		assert.equal(await tokenBalance(accessory.owner, mint), 2_000_000n, 'the owner holds the tokens');
		assert.ok((await balance(accessory.owner)) > 0n, 'and the SOL');
	});

	await test('release with sweep: assets go to the owner first, then remove_owner', async (s) => {
		const accessory = await claimed(s);
		await fund(accessory.wallet, 0.3);
		await open(s.page, '/accessory');
		await s.page.getByRole('button', { name: 'Manage accessory' }).last().click();
		await s.page.getByRole('button', { name: /^Release accessory/ }).click();
		await s.page.getByRole('button', { name: 'Move everything to owner first' }).click();
		await authorize(s, 'release-sweep');
		await s.page.getByText('Assets sent to owner').waitFor({ timeout: 60_000 });
		await s.page.getByRole('button', { name: /^Release accessory/ }).last().click();
		await authorize(s, 'remove-owner');
		await s.page.getByText('Accessory released').waitFor({ timeout: 60_000 });
		assert.equal(await ownerOf(accessory.pda), '11111111111111111111111111111111', 'no owner on chain');
	});

	await test('export: the key is shown only inside the signer; the app learns nothing', async (s) => {
		const posted: string[] = [];
		await s.page.exposeFunction('__recordSignerMessage', (m: string) => posted.push(m));
		await s.page.addInitScript(`window.addEventListener('message', (e) => {
			if (e.origin === ${JSON.stringify(SIGNER)}) window.__recordSignerMessage(JSON.stringify(e.data));
		});`);
		await createPasskeyWallet(s);
		await s.page.getByRole('button', { name: 'Owner options' }).click();
		await s.page.getByRole('menuitem', { name: 'Export key' }).click();
		await s.signer.getByRole('button', { name: 'Continue to export' }).click();
		await s.signer.locator('.reveal-btn').first().click();
		await capture(s, 'export-key');
		const secret = (await s.signer.locator('.export-secret').innerText()).trim();
		assert.match(secret, /^[1-9A-HJ-NP-Za-km-z]{80,90}$/, 'the key is revealed inside the signer');
		await s.signer.getByRole('button', { name: 'Done' }).click();
		await s.page.waitForTimeout(500);
		const leaked = [...posted, ...s.crossed.map((c) => c.value)].filter((m) => m.includes(secret) || m.includes(secret.slice(0, 32)));
		assert.equal(leaked.length, 0, 'the exported key never reaches the app or the network');
		assert.ok(posted.some((m) => m.includes('"completed":true')), 'the app only hears that export completed');
	});

	await test('tap to sign: an integrator site pays within the limits, and only within them', async (s) => {
		const accessory = await claimed(s);
		await fund(accessory.wallet, 0.5);
		await allowTapPayments(s);
		const recipient = (await generateKeyPairSigner()).address;

		const paid = await payOnDapp(s, accessory, recipient, 5_000_000n);
		assert.ok(paid.ok, `a 0.005 SOL tap payment lands: ${JSON.stringify(paid)}`);
		assert.equal(await balance(recipient), 5_000_000n);
		const tap = s.bridge.ceremonies.findLast((c) => c.nfc);
		assert.equal(tap?.origin, DAPP, 'the tap was signed on the integrator origin');

		const taps = s.bridge.ceremonies.filter((c) => c.nfc).length;
		const tooBig = await payOnDapp(s, accessory, recipient, 20_000_000n);
		assert.ok(!tooBig.ok, 'over the per-tap maximum is refused');
		assert.equal(s.bridge.ceremonies.filter((c) => c.nfc).length, taps, 'refused before asking for a tap');

		const memo = await payOnDapp(s, accessory, recipient, 0n, 'memo');
		assert.ok(!memo.ok, 'a program the owner never allowed is refused');
		assert.equal(await balance(recipient), 5_000_000n, 'nothing else moved');
	});

	await test('allowed sites: the owner restricts which sites can ask for a tap', async (s) => {
		const accessory = await claimed(s);
		await fund(accessory.wallet, 0.5);
		await allowTapPayments(s);
		const recipient = (await generateKeyPairSigner()).address;

		const setSites = async (sites: string[]) => {
			await openWallet(s.page, accessory.pda);
			await s.page.getByRole('button', { name: /^Tap to sign transactions/ }).click();
			for (const site of await s.page.getByRole('button', { name: /^Remove https?:/ }).all()) await site.click();
			for (const site of sites) {
				await s.page.getByLabel('Add a site').fill(site);
				await s.page.getByRole('button', { name: 'Add', exact: true }).click();
			}
			await s.page.getByRole('button', { name: 'Save changes' }).last().click();
			await authorize(s, `allowed-sites-${sites.length}`);
			const want = sites.map((site) => new URL(site).origin);
			const [policyPda] = await findPolicyPda({ phygitalToken: address(accessory.pda) });
			for (let i = 0; ; i++) {
				const policy = await fetchMaybeAccessoryPolicy(rpc, policyPda, { commitment: 'confirmed' });
				if (policy.exists && JSON.stringify(policy.data.allowedOrigins) === JSON.stringify(want)) break;
				if (i > 60) throw new Error(`allowed sites never became ${want}: ${policy.exists ? policy.data.allowedOrigins : 'no policy'}`);
				await new Promise((r) => setTimeout(r, 500));
			}
			await s.page.keyboard.press('Escape');
		};

		// A full URL with a path, as people paste it: stored as the bare origin.
		await setSites(['https://localhost:4301/checkout']);
		const taps = s.bridge.ceremonies.filter((c) => c.nfc).length;
		const refused = await payOnDapp(s, accessory, recipient, 5_000_000n);
		assert.ok(!refused.ok && /origin/i.test(`${refused.code} ${refused.message}`), `a site the owner didn't allow is refused: ${JSON.stringify(refused)}`);
		assert.equal(s.bridge.ceremonies.filter((c) => c.nfc).length, taps, 'refused before the tap');

		await setSites(['https://localhost:4301', DAPP]);
		const paid = await payOnDapp(s, accessory, recipient, 5_000_000n);
		assert.ok(paid.ok, `the allowed site can pay: ${JSON.stringify(paid)}`);
	});

	await test('recovery: cancel and a dismissed passkey prompt sign nothing; the next try works', async (s) => {
		const accessory = await claimed(s);
		await fund(accessory.wallet, 1);
		const recipient = (await generateKeyPairSigner()).address;
		await openWallet(s.page, accessory.pda);
		await s.page.getByRole('button', { name: /^Solana SOL/ }).click();
		await s.page.getByLabel('Send to').fill(recipient);
		await s.page.getByLabel('Amount').fill('0.1');
		const send = s.page.getByRole('button', { name: /^Send/ }).last();

		await send.click();
		await s.signer.getByRole('button', { name: /^Authorize/ }).waitFor();
		await s.signer.getByRole('button', { name: 'Cancel' }).click();
		await send.waitFor({ state: 'visible' });
		await s.page.waitForFunction(() => !document.querySelector('[aria-label="Cancel"].fixed'));

		s.bridge.failNext('NotAllowedError', 'get');
		await send.click();
		await s.signer.getByRole('button', { name: /^Authorize/ }).click();
		await s.page.waitForFunction(() => !document.querySelector('[aria-label="Cancel"].fixed'), undefined, { timeout: 30_000 });
		assert.equal(await balance(recipient), 0n, 'nothing was sent');

		await send.click();
		await authorize(s, 'send-sol-retry');
		await text(s.page, 'SOL sent').waitFor({ timeout: 60_000 });
		assert.equal(await balance(recipient), 100_000_000n, 'sent exactly once');
	});

	await test('hostile parent: crafted messages to the signer fail closed', async (s) => {
		await createPasskeyWallet(s);
		const wallet = (await passkeyAddress(s.page))! as Address;
		// Script on the app origin (an XSS) posting straight to the signer frame.
		const ask = (message: Record<string, unknown>, opts: { stamp?: boolean } = {}) =>
			s.page.evaluate(`(${ASK_SIGNER})(${JSON.stringify([message, SIGNER, opts.stamp ?? true])})`) as Promise<{ type: string; code?: string }>;
		const code = async (message: Record<string, unknown>, opts?: { stamp?: boolean }) => {
			const reply = await ask(message, opts);
			return reply.type === 'ERROR' ? reply.code : reply.type;
		};
		const tx = (wire: Uint8Array) => ({ type: 'SIGN_TRANSACTION', transaction: toB64(wire) });
		const signIn = (line1: string, line2: string) => ({ type: 'SIGN_MESSAGE', message: Buffer.from(`${line1}\n${line2}\n\nNonce: 1`).toString('base64') });

		assert.equal(await code({ type: 'SIGN_MESSAGE', message: 'aGk=', protocolVersion: 2, timestamp: Date.now() }, { stamp: false }), 'UNSUPPORTED_PROTOCOL');
		assert.equal(await code({ ...tx(removeOwnerWire({ owner: wallet })), extra: true }), 'INVALID_MESSAGE', 'unknown fields');
		assert.equal(await code({ ...tx(removeOwnerWire({ owner: wallet })), timestamp: Date.now() - 120_000 }), 'REPLAY_REJECTED', 'stale');
		assert.equal(await code({ ...tx(removeOwnerWire({ owner: wallet })), timestamp: Date.now() + 120_000 }), 'REPLAY_REJECTED', 'future');
		assert.ok(['INVALID_MESSAGE', 'NO_REPLY'].includes((await code({ type: 'SIGN_MESSAGE', message: 'A'.repeat(20_000) }))!), 'oversized: refused or dropped unparsed');
		const replayed = { ...signIn('evil.example wants you to sign in with your Solana account:', wallet), requestId: 'replayed-request-0001' };
		await code(replayed);
		assert.equal(await code(replayed), 'REPLAY_REJECTED', 'a reused requestId');

		assert.equal(await code(signIn('evil.example wants you to sign in with your Solana account:', wallet)), 'POLICY_REJECTED', 'sign-in for another site');
		assert.equal(await code(signIn('localhost:5173 wants you to sign in with your Solana account:', String(await generateKeyPairSigner().then((k) => k.address)))), 'POLICY_REJECTED', 'sign-in for another address');
		assert.equal(await code(tx(foreignProgramWire({ payer: wallet }))), 'POLICY_REJECTED', 'a top-level program owners never sign');
		assert.equal(await code(tx(removeOwnerWire({ owner: (await generateKeyPairSigner()).address }))), 'WALLET_MISMATCH', 'another wallet as owner');
		assert.notEqual(await code(tx(lookupTableWire({ owner: wallet }))), 'SIGN_TRANSACTION_RESULT', 'lookup tables');
		assert.equal(await code(tx(durableNonceWire({ owner: wallet }))), 'POLICY_REJECTED', 'durable nonce');
		assert.equal(await code(tx(doubleVerifyWire({ recipient: wallet }))), 'POLICY_REJECTED', 'two secp256r1 verifies');
		assert.equal(await s.signer.getByRole('button', { name: /^Authorize/ }).count(), 0, 'no refused request ever reached a confirm screen');

		// Undecodable inner calls reach the owner, but only as critical, behind "Authorize anyway".
		const opaque = ask(tx(opaqueExecuteWire({ owner: wallet })));
		await s.signer.getByRole('button', { name: 'Authorize anyway' }).waitFor({ timeout: 15_000 });
		assert.equal(await code(tx(removeOwnerWire({ owner: wallet }))), 'SIGNER_BUSY', 'one request at a time');
		await s.page.evaluate(() => {
			const frame = document.querySelector('iframe[title="Revibase Passkey"]') as HTMLIFrameElement;
			frame.style.height = '700px';
			frame.parentElement!.className = 'fixed inset-0 z-[70] bg-background';
		});
		await capture(s, 'opaque-inner-critical');
		await s.signer.getByRole('button', { name: 'Cancel' }).click();
		assert.equal(((await opaque) as { code?: string }).code, 'USER_CANCELLED');
	});

	await test('foreign site: framing the signer gets no replies and no key material', async (s) => {
		await s.page.goto(DAPP + '/frame.html');
		const frame = s.page.frameLocator('#signer');
		await frame.locator('body').waitFor();
		await s.page.waitForTimeout(1500);
		await s.page.evaluate(() => {
			const w = (document.getElementById('signer') as HTMLIFrameElement).contentWindow!;
			for (const type of ['AUTH_START', 'SIGN_MESSAGE', 'EXPORT_PRIVATE_KEY'])
				w.postMessage({ type, protocolVersion: 1, requestId: crypto.randomUUID().replaceAll('-', ''), timestamp: Date.now(), authMode: 'unlock', message: 'aGk=' }, '*');
		});
		await s.page.waitForTimeout(3000);
		const heard = await s.page.evaluate(() => (window as unknown as { heard: unknown[] }).heard);
		assert.deepEqual(heard, [], 'the signer answers nobody but the app');
		assert.equal(s.bridge.ceremonies.length, 0, 'and starts no passkey ceremony');
	});

	await test('reload: the wallet reconnects silently and still signs from this phone', async (s) => {
		await createPasskeyWallet(s);
		const before = s.bridge.ceremonies.length;
		await s.page.reload();
		await s.page.waitForLoadState('networkidle');
		await text(s.page, 'Your accessories').waitFor();
		assert.equal(s.bridge.ceremonies.length, before, 'no ceremony to reconnect');
	});
} finally {
	await browser.close();
	await dapp.close();
	writeFileSync(new URL(`report-${engine}.json`, results), JSON.stringify({ engine, outcomes, pageErrors }, null, 2));
	const failed = outcomes.filter((o) => o.status === 'failed').length;
	console.log(`${outcomes.length - failed}/${outcomes.length} e2e scenarios passed on ${engine}`);
	if (pageErrors.length) console.log('page errors:\n  ' + pageErrors.join('\n  '));
	process.exitCode = failed ? 1 : 0;
}
