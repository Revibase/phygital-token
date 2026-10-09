/** Test-only server. Never use this configuration for a build or deployment. */
import base from './vite.config.ts';
import { readFileSync } from 'node:fs';
import madlads from './test/browser/madlads.json' with { type: 'json' };
import { fileURLToPath } from 'node:url';
import { project, accessory, seed, OWNER } from './test/browser/fixtures.ts';

export default async function (env: any) {
	if (env.command !== 'serve') throw new Error('Browser simulation is restricted to the local dev server');
	const config = typeof base === 'function' ? await base(env) : base;
	const root = fileURLToPath(new URL('.', import.meta.url));
	const fixtures = JSON.stringify(root + 'test/browser/fixtures.ts');
	const state: any = {
		id: 'simulation-intent-0001',
		kind: 'phone',
		state: 'created',
		accessory: { pda: accessory.pda, tag: 'TEST', kind: 'bearer' },
		recipient: null,
		pairingCode: null,
		claimConflict: false,
		tapExpiresAt: null,
		tapWindowMs: null,
		expiresAt: Date.now() + 600_000,
		txSignature: null,
		walletApp: null,
		errorCode: null
	};
	const challenge = { linkId: state.id, challenge: 'simulated-hardware-challenge' };
	const plugin = {
		name: 'isolated-browser-simulation',
		enforce: 'pre' as const,
		resolveId(source: string) {
			if (source === '$lib/client/wallet/wallet.svelte' || source === root + 'src/lib/client/wallet/wallet.svelte')
				return root + 'test/browser/wallet.svelte.ts';
			if (source === '$lib/client/link/flow' || source === root + 'src/lib/client/link/flow') return root + 'test/browser/flow.ts';
		},
		load(id: string) {
			const path = id.split('?')[0];
			if (path === root + 'src/lib/client/media.ts')
				return `export async function fetchAccessoryMedia(){if(new URLSearchParams(location.search).get('mockup')==='madlads')return ${JSON.stringify(madlads)};return {image:'/icon-512.png',name:'Simulation NFT',owner:'7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',tokenStandard:'ProgrammableNonFungible',metadataUrl:'https://project.example/metadata.json',royaltyBps:420,description:'A sample NFT for previewing accessory experiences. Explore its artwork, collection and attributes.',collection:'Test project',collectionImage:'/icon-192.png',collectionAddress:'So11111111111111111111111111111111111111112',attributes:Array.from({length:8},(_,i)=>({label:'Trait '+(i+1),value:'Value '+(i+1)}))}}`;
			if (path.endsWith('/routes/+layout.server.ts')) return `export const load=()=>({cluster:'localnet',rpcUrl:'http://127.0.0.1:8899'});`;
			if (path.endsWith('/routes/accessory/+page.server.ts'))
				return `import { accessory } from ${fixtures}; export const load=({cookies,url})=>{if(url.searchParams.get('mockup')==='madlads')cookies.set('simulation_mockup','madlads',{path:'/',httpOnly:false});const requested=url.searchParams.get('kind');const kind=['bearer','controlled','permanent'].includes(requested)?requested:cookies.get('simulation_kind') ?? accessory.kind;const mint=cookies.get('simulation_mint') === 'none' ? null : url.searchParams.get('mockup')==='madlads'?'FVzM6rUA1SigPxh6e3iQ8dAPjQNf2guap3Xcdj8Q6R2H':accessory.mint;return {accessory:{...accessory,linkedWallet:cookies.get('simulation_owner') ?? accessory.linkedWallet,kind,mint,canLink:kind==='bearer',canRelease:kind!=='permanent',isLocked:kind!=='bearer',status:kind==='bearer'?'linked':'linked_locked'},sessionExpiresAt:Date.now()+600000,admit:'browse_unlock',loadError:false}};`;
			if (path.endsWith('/routes/unlink/[pda]/+page.server.ts'))
				return `import { accessory } from ${fixtures}; export const load=()=>({accessory:{...accessory,kind:'controlled',canLink:false,canRelease:true}});`;
			if (path.endsWith('/routes/accessory/link/+page.server.ts'))
				return `import { accessory } from ${fixtures}; export const load=({url})=>({accessory,pairedLinkId:url.searchParams.get('link')});`;
			if (path.endsWith('/routes/shortcut/[n]/+server.ts'))
				return `
				import { project, accessory, seed } from ${fixtures};
				import { withSessionProofs, openedLocation } from '$lib/server/accessory/shortcuts';
				import { proofKey } from '$lib/server/session/proof';
				export const GET=({params,url,cookies,request})=>{
					if(cookies.get('simulation_session')!=='tap') return new Response(null,{status:303,headers:{location:'/tap/expired'}});
					const picked=project.shortcuts[Number(params.n)];
					if(!picked) return new Response(null,{status:303,headers:{location:'/accessory'}});
					const [s]=withSessionProofs({...project,shortcuts:[picked]},{key:proofKey(seed),issuer:url.origin,accessory,session:{t:'bu',exp:Date.now()+600000}});
					return new Response(null,{status:303,headers:{location:openedLocation(s,url.searchParams.get('wallet'),url.origin)}});
				};`;
			if (path.endsWith('/routes/accessory/app/[n]/+page.server.ts'))
				return `
				import { project,accessory,seed } from ${fixtures};
				import { withSessionProofs } from '$lib/server/accessory/shortcuts';
				import { proofKey } from '$lib/server/session/proof';
				export const load=({params,url,locals,cookies})=>{const s=project.shortcuts[Number(params.n)];const [framed]=withSessionProofs({...project,shortcuts:[s]},{key:proofKey(seed),issuer:url.origin,accessory,session:{t:'bu',exp:Date.now()+600000}});locals.frameSrc=cookies.get('simulation_mockup')==='madlads'?url.origin:new URL(s.href).origin;return {label:s.label,host:'project.example',openHref:'/shortcut/'+params.n,frame:{src:cookies.get('simulation_mockup')==='madlads'?'/__simulation/project':framed.href,sandbox:'allow-scripts allow-same-origin allow-forms allow-popups',allow:'fullscreen; clipboard-write'}}};`;
		},
		configureServer(server: any) {
			server.middlewares.use(async (req: any, res: any, next: any) => {
				const path = new URL(req.url, 'http://localhost').pathname;
				if(path === '/__simulation/project'){res.setHeader('content-type','text/html');res.end(readFileSync(root + 'test/browser/embedded-project.html','utf8'));return;}
				if (
					!path.startsWith('/__simulation/') &&
					!path.startsWith('/api/link') &&
					path !== '/api/handoff/claim' &&
					path !== '/api/accessory/shortcuts'
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
				if (path === '/__simulation/reset') {
					Object.assign(state, { state: 'created', recipient: null, walletApp: null, txSignature: null, errorCode: null });
					return send(state);
				}
				if (path === '/__simulation/status') return send(state);
				if (path === '/__simulation/verify') {
					const { proofKey, verifySessionProof } = await server.ssrLoadModule('/src/lib/server/session/proof.ts');
					const key = proofKey(seed);
					return send(verifySessionProof(body.token, [key], { issuer: 'http://localhost:4187', audience: body.audience }));
				}
				if (path === '/api/accessory/shortcuts') return send({ shortcuts: project.shortcuts.map((s) => ({ ...s, proof: true })) });
				if (path === '/api/link' && req.method === 'POST') {
					res.setHeader('set-cookie', 'simulation_origin=1; Path=/; SameSite=Lax');
					return send({ ...state, challenge });
				}
				if (path === '/api/handoff/claim') {
					if (body.h !== 'simulation-handoff') return send({ error: 'Invalid handoff', code: 'bad_request' }, 400);
					state.state = 'claimed';
					res.setHeader('set-cookie', 'simulation_finisher=1; Path=/; SameSite=Lax');
					return send(state);
				}
				if (!/simulation_(origin|finisher)=1/.test(req.headers.cookie ?? '')) return send({ error: 'Forbidden', code: 'forbidden' }, 403);
				if (path.endsWith('/challenge')) return send(challenge);
				if (path.endsWith('/assertion')) {
					state.state = 'tapped';
					return send({ status: state, handoffUrl: 'http://localhost:4187/continue#h=simulation-handoff' });
				}
				if (path.endsWith('/recipient')) {
					state.recipient = body.address;
					state.state = 'finishing';
					return send({});
				}
				if (path.endsWith('/submitted')) {
					state.state = 'linked';
					state.walletApp = body.app;
					state.txSignature = body.signature;
					return send(state);
				}
				if (path.endsWith('/cancel')) state.state = 'cancelled';
				return send(state);
			});
		}
	};
	return { ...config, plugins: [plugin, ...(config as any).plugins], server: { host: 'localhost', port: 4187, strictPort: true, hmr: false, watch: { ignored: ['**/test/browser/results/**'] } } };
}
