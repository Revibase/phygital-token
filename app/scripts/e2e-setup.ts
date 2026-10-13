/**
 * Prepares the local end-to-end stack on a freshly reset validator:
 *
 *   solana-test-validator --reset --bpf-program phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz ../target/deploy/phygital_token.so
 *   pnpm e2e:setup
 *   REVIBASE_PLATFORM=e2e pnpm dev                          # the app on https://localhost:5173
 *   pnpm --filter secure-signer exec vite --mode e2e         # the signer on https://localhost:5174
 *   pnpm test:e2e
 *
 * It bootstraps AdminConfig, issues accessories, funds a fee-payer pool and
 * writes the app's e2e secrets (test/e2e/.dev.vars), a migrated D1 store
 * (.wrangler/e2e) and a self-signed localhost certificate (.wrangler/e2e/tls)
 * for both dev servers. State for the browser run goes to .wrangler/e2e/state.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getBase58Decoder } from '@solana/kit';

import { bytesToBase64Url } from '../src/lib/shared/encoding';
import { createAdmin, funded, issueAccessory, rpc, type AccessoryKind } from './lib';

const appRoot = new URL('../', import.meta.url);
const stateDir = new URL('.wrangler/e2e/', appRoot);
export const STATE_FILE = new URL('state.json', stateDir);

try {
	await rpc.getVersion().send();
} catch {
	throw new Error('No validator on 127.0.0.1:8899. Start solana-test-validator --reset with the program first.');
}

const { issuerKey } = await createAdmin();

// Fee-payer pool: base58 64-byte secret keys, funded well above the minimum balance.
const sponsorKeys: string[] = [];
for (let i = 0; i < 2; i++) {
	const seed = crypto.getRandomValues(new Uint8Array(32));
	const secret = new Uint8Array(64);
	secret.set(seed);
	secret.set(ed25519.getPublicKey(seed), 32);
	await funded(seed);
	sponsorKeys.push(getBase58Decoder().decode(secret));
}

const accessories: Record<string, { kind: AccessoryKind; pda: string; keys: ReturnType<ReturnType<typeof import('./lib').fakeAccessory>['keys']> }> = {};
for (const [name, kind] of [
	['bearer', 'bearer'],
	['controlled', 'controlled'],
	['spare', 'controlled']
] as const) {
	const { acc, pda } = await issueAccessory(issuerKey, kind);
	accessories[name] = { kind, pda: String(pda), keys: acc.keys() };
}

writeFileSync(
	new URL('test/e2e/.dev.vars', appRoot),
	`# Written by scripts/e2e-setup.ts for the local e2e stack only.\nSESSION_SECRET=${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}\nSPONSOR_KEYS=${sponsorKeys.join(',')}\n`
);

mkdirSync(new URL('tls/', stateDir), { recursive: true });
// HTTPS, as in production: WebKit keeps the signer's Secure, Partitioned vault cookie only there.
if (!existsSync(new URL('tls/cert.pem', stateDir))) {
	execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '30', '-subj', '/CN=localhost',
		'-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', 'tls/key.pem', '-out', 'tls/cert.pem'], { cwd: stateDir, stdio: 'ignore' });
}
execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '-c', 'test/e2e/wrangler.jsonc', '--persist-to', '.wrangler/e2e'], {
	cwd: appRoot,
	stdio: 'inherit',
	env: { ...process.env, CI: '1' }
});

writeFileSync(STATE_FILE, JSON.stringify({ issuer: bytesToBase64Url(issuerKey), accessories }, null, 2));
console.log(`e2e stack ready: ${Object.keys(accessories).join(', ')}`);
