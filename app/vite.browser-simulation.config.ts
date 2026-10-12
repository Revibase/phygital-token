/** Test-only server. Never use this configuration for a build or deployment. */
import base from './vite.config.ts';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import madlads from './test/browser/madlads.json' with { type: 'json' };
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { project, accessory, OWNER } from './test/browser/fixtures.ts';

export default async function (env: any) {
	if (env.command !== 'serve') throw new Error('Browser simulation is restricted to the local dev server');
	const config = typeof base === 'function' ? await base(env) : base;
	const root = fileURLToPath(new URL('.', import.meta.url));
	const fixtures = JSON.stringify(root + 'test/browser/fixtures.ts');
	const plugin = {
		name: 'isolated-browser-simulation',
		enforce: 'pre' as const,
		resolveId(source: string, importer?: string) {
			// Relative imports too, so no module reaches the real wallet or link flow.
			const target = source.startsWith('$lib/') ? root + 'src/lib/' + source.slice(5) : source.startsWith('.') && importer ? join(dirname(importer.split('?')[0]), source) : source;
			const module = target.replace(/\.ts$/, '');
			if (module === root + 'src/lib/client/wallet/wallet.svelte') return root + 'test/browser/wallet.svelte.ts';
			if (module === root + 'src/lib/client/link/flow') return root + 'test/browser/flow.ts';
		},
		load(id: string) {
			const path = id.split('?')[0];
			if (path === root + 'src/lib/client/media.ts')
				return `export async function fetchAccessoryMedia(){if(new URLSearchParams(location.search).get('mockup')==='madlads')return ${JSON.stringify(madlads)};return {image:'/icon-512.png',name:'Simulation NFT',owner:'7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',tokenStandard:'ProgrammableNonFungible',metadataUrl:'https://project.example/metadata.json',royaltyBps:420,description:'A sample NFT for previewing accessory experiences. Explore its artwork, collection and attributes.',collection:'Test project',collectionImage:'/icon-192.png',collectionAddress:'So11111111111111111111111111111111111111112',attributes:Array.from({length:8},(_,i)=>({label:'Trait '+(i+1),value:'Value '+(i+1)}))}}`;
			if (path === root + 'src/lib/client/accessory-wallet/holdings.ts')
				return `import { walletHoldings } from ${fixtures}; export async function fetchAccessoryWallet(){return walletHoldings(document.cookie.includes('simulation_holdings=funded'))}`;
			if (path === root + 'src/lib/client/accessory-wallet/send.ts')
				return `export { previewSweepApprovals as estimateSweepApprovals } from ${JSON.stringify(root + 'test/browser/sweep-estimate.ts')}; export async function opensTokenAccount(){return false} export async function recipientAccountFunding(){return {openAccount:false,rent:0n}} export async function sendFromAccessoryWallet(){throw new Error('Asset transfers are disabled in this local preview')} export async function sweepToOwner(){throw new Error('Asset transfers are disabled in this local preview')}`;
			if (path === root + 'src/lib/client/wallet-accessories.ts')
				return `import { accessory } from ${fixtures}; export async function fetchWalletAccessories(wallet){return wallet===accessory.owner?[accessory]:[]}`;
			if (path === root + 'src/lib/client/program-upgradeability.ts')
				return `export async function programUpgradeability(ids){return new Map(ids.map(id=>[id,true]))}`;
			if (path === root + 'src/lib/client/accessory-wallet/policy.ts')
				return `export { fetchAccessoryPolicy, savePolicy } from ${JSON.stringify(root + 'test/browser/policy-state.ts')}`;
			// Fee-payer choice reads balances on chain; here a cookie picks the outcome.
			if (path === root + 'src/lib/client/accessory-wallet/submit.ts')
				return `import { WALLET } from ${fixtures};
				import { fetchSponsor } from 'phygital-token-sdk';
				export const SPONSOR_ENDPOINT='/api/sponsor';
				export const sponsorQuery=(pda)=>({queryKey:['fees',pda,'sponsor'],queryFn:()=>fetchSponsor({endpoint:'/api/sponsor',phygitalToken:pda}),staleTime:15000});
				export async function previewFee(){const v=(document.cookie.match(/simulation_fee=(\\w+)/)||[])[1]??'owner';if(v==='free')return{kind:'free'};if(v==='refill')return{kind:'refill',lamports:4_975_000n};if(v==='blocked')return{kind:'blocked',reason:'accessory',neededLamports:5_865_880n,address:WALLET};return{kind:'owner'}}
				export { submitAsOwner, submitAsOwner as confirmAsOwner } from ${JSON.stringify(root + 'test/browser/policy-state.ts')}
				export async function refillNetworkFees(){throw new Error('Signing must be simulated explicitly')}`;
			if (path.endsWith('/routes/wallet/[pda]/+page.server.ts'))
				return `import { accessory, WALLET } from ${fixtures}; export const load=({cookies})=>{const kind=cookies.get('simulation_kind') ?? accessory.kind;const owner=cookies.get('simulation_owner') ?? accessory.owner;return {accessory:{...accessory,kind,owner:owner==='none'?null:owner},wallet:WALLET,accessoryHref:'/accessory'}};`;
			if (path === root + 'src/hooks.server.ts')
				return readFileSync(path, 'utf8').replace(
					'const signerOrigin = event.platform?.env?.SECURE_SIGNER_ORIGIN ?? null;',
					"const signerOrigin = 'http://localhost:5174';"
				);
			if (path.endsWith('/routes/+layout.server.ts')) return `import { deviceClass } from '$lib/shared/device'; export const load=({request,cookies})=>({cluster:'localnet',rpcUrl:'http://127.0.0.1:8899',signerOrigin:cookies.get('simulation_signer')==='on'?'http://localhost:5174':'',device:cookies.get('simulation_device')==='mobile'?'mobile':deviceClass(request.headers.get('user-agent'))});`;
			if (path.endsWith('/routes/accessory/+page.server.ts'))
				return `import { redirect } from '@sveltejs/kit'; import { accessory } from ${fixtures}; export const load=({cookies,url})=>{if(cookies.get('simulation_session')==='expired')redirect(303,'/tap/expired');if(url.searchParams.get('mockup')==='madlads')cookies.set('simulation_mockup','madlads',{path:'/',httpOnly:false});const requested=url.searchParams.get('kind');const kind=['bearer','controlled','permanent'].includes(requested)?requested:cookies.get('simulation_kind') ?? accessory.kind;const mint=cookies.get('simulation_mint') === 'none' ? null : url.searchParams.get('mockup')==='madlads'?'FVzM6rUA1SigPxh6e3iQ8dAPjQNf2guap3Xcdj8Q6R2H':accessory.mint;return {accessory:{...accessory,owner:cookies.get('simulation_owner') ?? accessory.owner,kind,mint,canLink:kind==='bearer',canRelease:kind!=='permanent',isLocked:kind!=='bearer',status:kind==='bearer'?'linked':'linked_locked'},sessionExpiresAt:Date.now()+600000,admit:'browse_unlock',loadError:false}};`;
			if (path.endsWith('/routes/accessory/link/+page.server.ts'))
				return `import { accessory } from ${fixtures}; export const load=()=>({accessory,rpId:'localhost'});`;
		},
		configureServer(server: any) {
			server.middlewares.use(async (req: any, res: any, next: any) => {
				const path = new URL(req.url, 'http://localhost').pathname;
				if (path === '/__simulation' || path === '/__simulation/start') {
					res.setHeader('content-type', 'text/html; charset=utf-8');
					res.setHeader('cache-control', 'no-store');
					if (path === '/__simulation') { res.end(readFileSync(root + 'test/browser/preview.html', 'utf8')); return; }
					const scenario = new URL(req.url, 'http://localhost').searchParams.get('scenario') ?? 'preset';
					const policy = scenario === 'existing' || scenario === 'journey' ? 'on' : scenario === 'paused' ? 'small' : 'off';
					res.setHeader('set-cookie', ['simulation_session=tap', 'simulation_holdings=funded', `simulation_policy=${policy}`, 'simulation_device=mobile', 'simulation_fee=owner', `simulation_prepaid=${scenario === 'paused' ? '0' : '5000000'}`].map(c => `${c}; Path=/; SameSite=Lax`));
					let target = scenario === 'journey' ? '/accessory' : `/wallet/${accessory.pda}`;
					if (scenario === 'safe' || scenario === 'risky') {
						const request = scenario === 'safe'
							? { v: 1, name: 'Example payments project', reason: 'Let a tap send small SOL payments.', programs: [{ id: '11111111111111111111111111111111', access: { only: [{ selector: '02000000' }] } }], limits: [{ asset: 'SOL', amount: '100000000', period: 'day', maxPerTap: '10000000' }] }
							: { v: 1, name: 'Example staking project', reason: 'Review broad program access before allowing it.', programs: [{ id: 'Stake11111111111111111111111111111111111111', access: 'all' }], limits: [] };
						target = '/permissions#r=' + deflateRawSync(JSON.stringify(request)).toString('base64url');
					}
					res.end(`<script>localStorage.setItem('simulation:browser-wallet','true');localStorage.setItem('simulation:clickthrough','true');localStorage.removeItem('simulation:policy');location.replace(${JSON.stringify(target)})</script>`);
					return;
				}
				if (
					!path.startsWith('/__simulation/') &&
					path !== '/api/accessory/shortcuts' &&
					path !== '/api/sponsor' &&
					!path.startsWith('/api/signer/')
				)
					return next();
				let raw = '';
				for await (const chunk of req) raw += chunk;
				const body = raw ? JSON.parse(raw) : {};
				const send = (value: any, status = 200) => {
					res.statusCode = status;
					res.setHeader('content-type', 'application/json');
					res.end(JSON.stringify(value));
				};
				if (path === '/__simulation/status') return send({ ready: true });

				if (path.startsWith('/api/signer/')) {
					res.setHeader('access-control-allow-origin', 'http://localhost:5174');
					res.setHeader('access-control-allow-methods', 'POST, PUT');
					res.setHeader('access-control-allow-headers', 'content-type');
					if (req.method === 'OPTIONS') return send({});
					if (path.endsWith('-challenge')) return send({ challengeId: 'simulation-challenge-0001', challenge: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') });
					if (path === '/api/signer/restore') return send({ error: 'No wallet backup for this passkey', code: 'not_found' }, 404);
					return send({ ok: true, created: true });
				}
				if (path === '/api/sponsor') {
					const prepaid = /simulation_prepaid=(\d+)/.exec(req.headers.cookie ?? '')?.[1] ?? '5000000';
					return send({ feePayers: ['FeePay1111111111111111111111111111111111111'], maxComputeUnitLimit: 400000, maxComputeUnitPrice: '100000', prepaidLamports: '5000000', balanceLamports: prepaid });
				}
				if (path === '/api/accessory/shortcuts') return send({ shortcuts: project.shortcuts });
				return next();
			});
		}
	};
	return { ...config, plugins: [plugin, ...(config as any).plugins], server: { host: 'localhost', port: 4187, strictPort: true, hmr: false, watch: { ignored: ['**/test/browser/results/**'] } } };
}
