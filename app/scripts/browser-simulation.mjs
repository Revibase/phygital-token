import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
const requestLink = (set) => BASE + '/permissions#r=' + deflateRawSync(JSON.stringify(set)).toString('base64url');
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = 'http://localhost:4187',
	OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
const readiness = await fetch(BASE + '/__simulation/status');
assert.equal(readiness.status, 200, 'Start dev:simulation on localhost:4187 before running browser scenarios');
const browser =
	process.env.SIMULATION_ENGINE === 'webkit'
		? await webkit.launch()
		: await chromium.launch({ channel: process.env.SIMULATION_CHANNEL, headless: true });
const results = [],
	errors = [],
	contexts = [],
	output = new URL('../test/browser/results/', import.meta.url);
await mkdir(output, { recursive: true });
async function test(name, fn) {
	if (process.env.SIMULATION_FILTER && !new RegExp(process.env.SIMULATION_FILTER).test(name)) return;
	try {
		await fn();
		results.push({ name, status: 'passed' });
		console.log('PASS ' + name);
	} catch (e) {
		results.push({ name, status: 'failed', error: String(e) });
		console.error('FAIL ' + name + ': ' + e);
		for (const c of contexts.slice(-1))
			for (const p of c.pages()) {
				console.log('DEBUG PAGE', p.url(), (await p.locator('body').innerText()).slice(0, 600));
			}
	}
}
async function context(ua = IOS, storage) {
	const c = await browser.newContext({
		userAgent: ua,
		viewport: { width: ua.includes('Mobile') ? 390 : 1280, height: 844 },
		storageState: storage
	});
	contexts.push(c);
	await c.addCookies([{ name: 'simulation_session', value: 'tap', url: BASE }]);
	await c.route('**/*', (r) => (new URL(r.request().url()).hostname === 'localhost' ? r.continue() : r.abort()));
	await c.route('https://project.example/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Project experience</h1>' }));
	const p = await c.newPage();
	p.on('pageerror', (e) => errors.push(String(e)));
	return { c, p };
}
async function visible(p, text) {
	await p.getByText(text, { exact: true }).first().waitFor({ timeout: 15000 });
}
async function navigate(p) {
	await p.goto(BASE + '/accessory');
	await visible(p, 'Stake NFT');
}
try {
	for (const kind of ['controlled', 'permanent']) {
	await test(kind + ': minted token renders NFT, shortcuts and NFT attributes', async () => {
		const {c,p} = await context();
		await c.addCookies([{name:'simulation_kind',value:kind,url:BASE}]);
		await navigate(p);
		await p.getByRole('heading',{name:'Simulation NFT',exact:true}).waitFor();
		await visible(p,'Play');
		await visible(p,'Visit website');
		await p.getByRole('button',{name:'View NFT details',exact:true}).click();
		const nft=p.getByRole('dialog');
		await nft.getByRole('heading',{name:'Simulation NFT',exact:true}).waitFor();
		await nft.getByText('Test project',{exact:true}).waitFor();
		await nft.getByText('A sample NFT for previewing accessory experiences. Explore its artwork, collection and attributes.',{exact:true}).waitFor();
		await nft.getByText('Value 8',{exact:true}).waitFor();
		const cols=await nft.locator('dl.grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
		assert.equal(cols,3);
		await nft.getByRole('button',{name:'Copy NFT mint',exact:true}).waitFor();
		await nft.getByRole('button',{name:'Copy NFT owner',exact:true}).waitFor();
		await nft.getByText('7xKX…gAsU',{exact:true}).waitFor();

		await nft.getByText('So11…1112',{exact:true}).waitFor();
		await nft.getByText('4.20%',{exact:true}).waitFor();
		await nft.getByRole('link',{name:'View collection on Solana Explorer',exact:true}).waitFor();
		await nft.getByRole('button',{name:'Close',exact:true}).waitFor();
		await p.keyboard.press('Escape');
		await nft.waitFor({state:'hidden'});
		await p.getByText('Owns NFT',{exact:true}).waitFor();
		await p.getByRole('button',{name:'Manage accessory',exact:true}).click();
		await p.getByRole('button',{name:'Accessory details',exact:true}).click();
		const details=p.getByRole('dialog',{name:'Details'});
		assert.equal(await details.getByRole('heading',{name:'Traits',exact:true}).count(),0);
		assert.equal(await details.getByText('Trait 1',{exact:true}).count(),0);
		await details.getByText(kind==='controlled'?'Unlink before relinking':'Bound to one wallet',{exact:true}).waitFor();
		await details.getByText('Locked',{exact:true}).waitFor();
		await details.getByRole('link',{name:'View collectible on Solana Explorer',exact:true}).waitFor();
		await p.keyboard.press('Escape');
		await details.waitFor({state:'hidden'});
		assert.equal(await p.getByRole('link',{name:'Stake NFT',exact:true}).getAttribute('target'),'_blank');
	});
}
	await test('small phone and landscape layouts keep actions reachable without horizontal overflow', async () => {
		for (const viewport of [{width:320,height:568},{width:844,height:390}]) {
			const {p}=await context();
			await p.setViewportSize(viewport);
			await navigate(p);
			assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
			await p.getByRole('button',{name:'View NFT details',exact:true}).click();
			const dialog=p.getByRole('dialog');
			const close=dialog.getByRole('button',{name:'Close',exact:true});
			{
				await close.waitFor();
				await close.click({trial:true});
				const box=await close.boundingBox();
				assert.ok(box.height>=44 && box.y>=0 && box.y+box.height<=viewport.height,JSON.stringify({viewport,box}));
			}
			assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
			await close.click();
			await dialog.waitFor({state:'hidden'});
		}
	});
	await test('project app loading failure offers a working retry', async () => {
		const {c,p}=await context();
		await c.route('**/api/accessory/shortcuts**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'offline'})}));
		await p.goto(BASE+'/accessory');
		await visible(p,'Couldn’t load project apps');
		await c.unroute('**/api/accessory/shortcuts**');
		await p.getByRole('button',{name:'Try again',exact:true}).click();
		await visible(p,'Stake NFT');
		assert.equal(await p.getByText('Couldn’t load project apps',{exact:true}).count(),0);
	});
	await test('NFT owner comparison uses the owner, not the connected account', async () => {
		const {c,p}=await context();
		await c.addCookies([{name:'simulation_owner',value:'So11111111111111111111111111111111111111112',url:BASE}]);
		await navigate(p);
		await p.getByText('NFT held elsewhere',{exact:true}).waitFor();
		assert.equal(await p.getByText('Owns NFT',{exact:true}).count(),0);
		assert.equal(await p.getByRole('dialog').count(),0);
	});
	await test('desktop shows Open on your phone without leaking tap parameters', async () => {
		const {p}=await context('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0');
		await p.goto(BASE+'/wallet/So11111111111111111111111111111111111111112?action=x');
		await visible(p,'Open on your phone');
		await p.getByRole('img',{name:'QR code to open this page on your phone'}).locator('svg').waitFor();
		await visible(p,BASE+'/wallet/So11111111111111111111111111111111111111112');
		const ipad=await context('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15');
		await ipad.c.addInitScript(()=>Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5}));
		await navigate(ipad.p);
		assert.equal(await ipad.p.getByText('Open on your phone',{exact:true}).count(),0);
	});
	await test('owner changed elsewhere is noticed against what this browser linked', async () => {
		const {c,p}=await context();
		const pda='So11111111111111111111111111111111111111112';
		await c.addInitScript(({wallet,pda}) => localStorage.setItem('revibase:linked:'+pda,wallet), {wallet:OWNER,pda});
		await navigate(p);
		assert.equal(await p.getByText('Owner changed',{exact:true}).count(),0);
		await c.addCookies([{name:'simulation_owner',value:pda,url:BASE}]);
		await p.evaluate(() => window.dispatchEvent(new Event('focus')));
		await visible(p,'Owner changed');
	});
	await test('controlled: no mint skips metadata and shortcut requests', async () => {
		const {c,p} = await context();
		await c.addCookies([{name:'simulation_kind',value:'controlled',url:BASE},{name:'simulation_mint',value:'none',url:BASE}]);
		const requests=[];
		p.on('request',r=>{if (/\/api\/accessory\/(media|shortcuts)/.test(r.url())) requests.push(r.url());});
		await p.goto(BASE+'/accessory');
		await p.getByRole('button',{name:'Manage accessory',exact:true}).waitFor();
		assert.equal(await p.getByRole('heading',{name:'Simulation NFT',exact:true}).count(),0);
		assert.equal(await p.getByText('Stake NFT',{exact:true}).count(),0);
		assert.deepEqual(requests,[]);
	});
	await test('shortcut opens a direct browser link without session data', async () => {
  const {c,p}=await context();
  await c.route('https://staking.example/**', r=>r.fulfill({contentType:'text/html',body:'<h1>Staking site</h1>'}));
  await navigate(p);
  const next=c.waitForEvent('page');
  const link=p.getByRole('link',{name:'Stake NFT',exact:true});
  const href=await link.getAttribute('href');
  await link.click();
  const opened=await next;
  await opened.waitForURL('https://staking.example/**');
  assert.equal(opened.url(),href);
  assert.equal(p.url(),BASE+'/accessory');
 });
	await test('browser shortcut opens external tab without wallet handoff', async () => {
		const { c, p } = await context();
		await navigate(p);
		const next = c.waitForEvent('page');
		await p.getByRole('link', { name: 'Visit website', exact: true }).click();
		const q = await next;
		await q.waitForURL('https://project.example/about**');
		assert.ok(q.url().startsWith('https://project.example/about'));
		assert.equal(p.url(), BASE + '/accessory');
	});
	await test('Play opens a browser tab rather than embedding', async () => {
  const {c,p}=await context();
  await navigate(p);
  const next=c.waitForEvent('page');
  await p.getByRole('link',{name:'Play',exact:true}).click();
  const q=await next;
  await q.waitForURL('https://project.example/play**');
  assert.equal(p.url(),BASE+'/accessory');
  assert.equal(await p.locator('iframe[src*="project.example"]').count(),0);
 });

	const claim = async (p) => {
		await p.goto(BASE + '/accessory/link');
		await p.getByRole('button', { name: 'Approve', exact: true }).click();
		if (await p.getByRole('button', {name:'Connect wallet',exact:true}).isVisible()) await p.getByRole('button', {name:'Connect wallet',exact:true}).click();
		await p.getByRole('button', { name: 'Phantom', exact: true }).click();
	};
	await test('Safari claims in place: tap, wallet and approval all on the page that tapped', async () => {
		const { c, p } = await context();
		await c.addInitScript(() => localStorage.setItem('simulation:browser-wallet', 'true'));
		await claim(p);
		await p.getByRole('button', { name: 'Claim accessory', exact: true }).click();
		await visible(p, 'Accessory claimed');
		assert.equal(await p.evaluate(() => localStorage.getItem('revibase:recent-wallet')), 'Phantom');
		assert.equal(await p.evaluate(() => localStorage.getItem('revibase:linked:So11111111111111111111111111111111111111112')), OWNER);
		await p.getByRole('link', { name: 'Use accessory', exact: true }).click();
		await p.waitForURL('**/accessory');
	});
	await test('Android: a detected wallet claims from the tapping browser', async () => {
		const {c, p} = await context(ANDROID);
		await c.addInitScript(() => localStorage.setItem('simulation:browser-wallet', 'true'));
		await claim(p);
		await p.getByRole('button', {name:'Claim accessory', exact:true}).click();
		await visible(p, 'Accessory claimed');
	});

	await test('a rejected claim is recoverable without tapping again', async () => {
		const { c, p } = await context();
		await c.addInitScript(() => localStorage.setItem('simulation:browser-wallet', 'true'));
		await claim(p);
		await p.evaluate(() => sessionStorage.setItem('simulation:reject', 'true'));
		await p.getByRole('button', { name: 'Claim accessory', exact: true }).click();
		await visible(p, 'Cancelled in your wallet');
		await p.evaluate(() => sessionStorage.removeItem('simulation:reject'));
		await p.getByRole('button', { name: 'Claim accessory', exact: true }).click();
		await visible(p, 'Accessory claimed');
	});
	await test('no detected wallet explains what to install', async () => {
		const { p } = await context();
		await p.goto(BASE + '/accessory/link');
		await p.getByRole('button', { name: 'Approve', exact: true }).click();
		await p.getByRole('button', { name: 'Connect wallet', exact: true }).click();
		await visible(p, 'No wallet found');
	});

	{
		await test('Solana Pay fallback', async () => {
			const { c, p } = await context();
			const href = 'solana:https%3A%2F%2Fmerchant.example%2Fpay%3Forder%3D123';
			await c.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__copiedPayment = value; } } }));
			await c.route('**/api/accessory/shortcuts**', r => r.fulfill({contentType:'application/json',body:JSON.stringify({shortcuts:[{label:'Pay',href,icon:'tip',image:null,external:true,platform:'all'}]})}));
			await p.goto(BASE + '/accessory');
			await p.getByRole('button',{name:'Pay',exact:true}).click();
			const dialog=p.getByRole('dialog');
			await dialog.getByRole('img',{name:'Solana Pay request QR code'}).locator('svg').waitFor();
			assert.equal(await dialog.getByRole('link',{name:'Open in wallet',exact:true}).getAttribute('href'),href);
			await dialog.getByRole('button',{name:'Copy payment link',exact:true}).click();
			assert.equal(await p.evaluate(()=>window.__copiedPayment),href);
			await dialog.getByRole('link',{name:'Get a wallet',exact:true}).waitFor();
			assert.equal(await p.getByText('Payment complete',{exact:true}).count(),0);
			await p.keyboard.press('Escape');
			await dialog.waitFor({state:'hidden'});
		});
	}
	const PDA = 'So11111111111111111111111111111111111111112';
	const openWallet=async(p)=>{
		await p.goto(BASE+'/wallet/'+PDA);
		const gotIt=p.getByRole('button',{name:'Got it',exact:true});
		await gotIt.waitFor({timeout:5000}).then(()=>gotIt.click(),()=>{});
		await visible(p,'USDC');
	};
	const connectOwner=async(p)=>{
		const connect=p.getByRole('button',{name:'Connect wallet',exact:true});
		if (await connect.isVisible()) await connect.click();
		await p.getByRole('button',{name:'Phantom',exact:true}).click();
	};
	const openSendSol=async(p)=>{
		await p.getByRole('button',{name:/^Solana SOL/}).click();
		await p.getByRole('heading',{name:'Send SOL',exact:true}).waitFor();
	};
	await test('accessory wallet: balances, intro and receive QR', async () => {
		const {c,p}=await context();
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE}]);
		await navigate(p);
		await p.getByRole('button',{name:'Manage accessory',exact:true}).click();
		await p.getByRole('link',{name:/^Accessory wallet/}).click();
		await p.waitForURL('**/wallet/'+PDA);
		await p.getByRole('heading',{name:'About this wallet',exact:true}).waitFor();
		await visible(p,'This wallet is optional.');
		await p.getByRole('button',{name:'Got it',exact:true}).click();
		await p.getByRole('dialog').waitFor({state:'hidden'});
		await visible(p,'USDC');
		await p.getByRole('button',{name:/^Solana SOL 1\.2/}).waitFor();
		await p.getByRole('button',{name:'Receive',exact:true}).click();
		await p.getByRole('img',{name:'Accessory wallet address QR code'}).waitFor();
		await p.screenshot({path:'/private/tmp/revibase-wallet-receive.png'});
		await p.keyboard.press('Escape');
		await p.reload();
		await visible(p,'USDC');
		assert.equal(await p.getByRole('dialog').count(),0,'the intro shows once');
	});
	await test('accessory wallet: view only until claimed', async () => {
		const {c,p}=await context();
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE},{name:'simulation_owner',value:'none',url:BASE}]);
		await p.goto(BASE+'/wallet/'+PDA);
		await p.getByRole('button',{name:'Got it',exact:true}).click();
		await visible(p,'View only');
		await visible(p,'USDC');
		for (const name of ['Receive','Send all']) assert.equal(await p.getByRole('button',{name,exact:true}).count(),0,name+' is hidden');
		assert.equal(await p.getByRole('button',{name:/^Tap to sign transactions/}).count(),0,'tap settings are hidden');
		assert.equal(await p.getByRole('button',{name:/^Solana SOL/}).count(),0,'assets are not selectable');
		await p.getByRole('button',{name:'Copy wallet address',exact:true}).waitFor();
	});
	await test('accessory wallet: send connects the owner in place', async () => {
		const {c,p}=await context(IOS+' Phantom');
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE}]);
		await openWallet(p);
		await openSendSol(p);
		await p.getByPlaceholder('Solana address').fill('not-an-address');
		await p.getByLabel('Amount').fill('1');
		await visible(p,'Enter a valid Solana address.');
		await p.getByPlaceholder('Solana address').fill(OWNER);
		await p.getByRole('button',{name:'Max',exact:true}).click();
		assert.equal(await p.getByLabel('Amount').inputValue(),'1.2');
		await connectOwner(p);
		await p.getByRole('button',{name:'Send remaining SOL',exact:true}).waitFor();
		await p.evaluate(() => window.dispatchEvent(new CustomEvent('simulation:account',{detail:'So11111111111111111111111111111111111111112'})));
		await visible(p,'Only the owner can approve transactions');
		await p.getByRole('dialog').waitFor({state:'hidden'});
	});
	await test('tap payments: status is public, editing needs the owner', async () => {
		const {c,p}=await context(IOS+' Phantom');
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE},{name:'simulation_policy',value:'on',url:BASE}]);
		await openWallet(p);
		await p.getByRole('button',{name:/^Tap to sign transactions On/}).click();
		await p.getByRole('switch',{name:'Allow transactions',exact:true}).waitFor();
		assert.equal(await p.getByLabel('SOL',{exact:true}).inputValue(),'0.5');
		assert.equal(await p.getByLabel('USDC',{exact:true}).inputValue(),'20');
		assert.equal(await p.getByLabel('Bonk',{exact:true}).count(),0,'unused limits stay out of the editor');
		await p.getByLabel('SOL',{exact:true}).fill('0.6');
		await connectOwner(p);
		await p.getByRole('button',{name:'Save changes',exact:true}).waitFor();
	});
	await test('tap permissions: the owner limits which sites can ask for a tap', async () => {
		const {c,p}=await context(IOS+' Phantom');
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE},{name:'simulation_policy',value:'on',url:BASE}]);
		await c.addInitScript(() => localStorage.setItem('simulation:clickthrough','true'));
		const openSheet=async()=>{
			const gotIt=p.getByRole('button',{name:'Got it',exact:true});
			await gotIt.waitFor({timeout:5000}).then(()=>gotIt.click(),()=>{});
			await p.getByRole('button',{name:/^Tap to sign transactions/}).click();
			if (await p.getByRole('button', {name:'Connect wallet',exact:true}).isVisible()) await p.getByRole('button', {name:'Connect wallet',exact:true}).click();
			if (await p.getByRole('button',{name:'Phantom',exact:true}).isVisible()) await p.getByRole('button',{name:'Phantom',exact:true}).click();
			await p.getByText('Allow transactions',{exact:true}).waitFor();
		};
		await p.goto(BASE+'/wallet/'+PDA);
		await openSheet();
		await visible(p,'Any site');
		const site=p.getByLabel('Add a site',{exact:true});
		await site.fill('not a site');
		await site.press('Enter');
		await visible(p,'Enter a site like app.example.com.');
		await site.fill('https://Game.Example.com/play');
		await site.press('Enter');
		await visible(p,'https://game.example.com');
		const connect=p.getByRole('button',{name:'Connect wallet',exact:true});
		if (await connect.isVisible()) { await connect.click(); await p.getByRole('button',{name:'Phantom',exact:true}).click(); }
		await p.getByRole('button',{name:'Save changes',exact:true}).click();
		await visible(p,'Tap permissions saved');
		await p.reload();
		await openSheet();
		await visible(p,'https://game.example.com');
		await p.screenshot({path:'/private/tmp/revibase-allowed-sites.png'});
	});
	await test('network fee line: the owner pays when it can, else free fees, refills, or a top-up', async () => {
		for (const [fee, text] of [
			['owner', 'Network fee: paid by owner'],
			['free', 'Network fee: covered'],
			['refill', 'Fee top-up: 0.004975 SOL from the accessory wallet.'],
			['blocked', 'Add SOL to the accessory wallet']
		]) {
			const {c,p}=await context(IOS+' Phantom');
			await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE},{name:'simulation_fee',value:fee,url:BASE}]);
			await openWallet(p);
			await openSendSol(p);
			await p.getByPlaceholder('Solana address').fill(OWNER);
			await p.getByLabel('Amount').fill('0.01');
			await connectOwner(p);
			await visible(p,text);
			if (fee==='blocked') {
				await p.getByRole('button',{name:'Receive SOL',exact:true}).click();
				await visible(p,'Send SOL on Solana to the accessory wallet.');
				await p.screenshot({path:'/private/tmp/revibase-fee-blocked.png'});
			}
			await c.close();
		}
	});
	await test('tap payments paused: the owner refills network fees from the wallet page', async () => {
		const {c,p}=await context(IOS+' Phantom');
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE},{name:'simulation_policy',value:'small',url:BASE},{name:'simulation_prepaid',value:'0',url:BASE}]);
		await openWallet(p);
		assert.equal(await p.getByText('Top up fees to use tap signing',{exact:true}).count(),0,'only the owner sees it');
		await p.evaluate((owner) => window.dispatchEvent(new CustomEvent('simulation:account',{detail:owner})), OWNER);
		await visible(p,'Top up fees to use tap signing');
		await p.getByRole('button',{name:/^Top up .* SOL$/}).waitFor();
		await p.screenshot({path:'/private/tmp/revibase-refill-fees.png'});
	});
	await test('release warns when the accessory wallet holds funds', async () => {
		const {c,p}=await context(IOS+' Phantom');
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE},{name:'simulation_kind',value:'controlled',url:BASE}]);
		await navigate(p);
		await p.getByRole('button',{name:'Manage accessory',exact:true}).click();
		await p.getByRole('button',{name:/^Connect as owner/}).click();
		await p.getByRole('button',{name:'Phantom',exact:true}).click();
		await p.getByRole('button',{name:/^Release accessory/}).click();
		await p.getByRole('heading',{name:'Release this accessory?',exact:true}).waitFor();
		await p.getByText(/^This accessory wallet holds 1\.2 SOL/).waitFor();
		await p.getByRole('button',{name:'Move everything to owner first',exact:true}).waitFor();
		await p.getByRole('button',{name:'Release anyway',exact:true}).waitFor();
	});
	await test('permissions editor: preset, custom actions and JSON import', async () => {
		const {c,p}=await context(IOS+' Phantom');
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE}]);
		await openWallet(p);
		await p.getByRole('button',{name:/^Tap to sign transactions Off/}).click();
		await p.getByRole('switch',{name:'Allow transactions',exact:true}).click();
		const dialog=p.getByRole('dialog');
		await dialog.getByRole('button',{name:/^Custom actions Payments only/}).click();
		await dialog.getByRole('button',{name:/^System Program/}).click();
		await dialog.getByText('Allowed actions',{exact:true}).waitFor();
		// Untouched preset programs leave without a discard prompt.
		await dialog.getByRole('button',{name:'Back',exact:true}).click();
		await dialog.getByRole('button',{name:'Back',exact:true}).click();
		assert.equal(await p.getByText('Discard unsaved changes?',{exact:true}).count(),0);
		await dialog.getByRole('button',{name:/^Custom actions Payments only/}).waitFor();
		await p.getByRole('button',{name:'Permissions options',exact:true}).click();
		await p.getByRole('menuitem',{name:'Import permissions',exact:true}).click();
		await p.getByLabel('Permissions JSON').fill(JSON.stringify({v:1,programs:[{id:'Stake11111111111111111111111111111111111111',access:{only:[{selector:'02000000'}]}}],limits:[]}));
		await visible(p,'This replaces your current permissions:');
		await p.getByRole('button',{name:'Use these permissions',exact:true}).click();
		await dialog.getByRole('button',{name:/^Custom actions 1 program/}).click();
		await dialog.getByRole('button',{name:/^Stake Program/}).click();
		await dialog.getByText('Allowed actions',{exact:true}).waitFor();
		await p.screenshot({path:'/private/tmp/revibase-permissions-editor.png'});
	});
	await test('permission request: danger acknowledgement, accessory choice and edit', async () => {
		const {c,p}=await context(IOS+' Phantom');
		await c.addCookies([{name:'simulation_holdings',value:'funded',url:BASE}]);
		await p.goto(requestLink({v:1,name:'Example project',programs:[{id:'Stake11111111111111111111111111111111111111',access:'all'}],limits:[]}));
		await p.getByRole('button', {name:'Connect wallet',exact:true}).click();
		await p.getByRole('button',{name:'Phantom',exact:true}).click();
		await visible(p,'Allow Stake Program to do everything');
		const allow=p.getByRole('button',{name:'Allow these permissions',exact:true});
		assert.equal(await allow.isEnabled(),false);
		await p.getByRole('checkbox',{name:'I understand the risk',exact:true}).check();
		assert.equal(await allow.isEnabled(),true);
		await p.screenshot({path:'/private/tmp/revibase-permissions-request.png'});
		await p.getByRole('button',{name:'Edit before allowing',exact:true}).click();
		await p.getByRole('heading',{name:'Tap to sign transactions',exact:true}).waitFor();
		await p.getByRole('dialog').getByRole('button',{name:/^Custom actions/}).click();
		await p.getByRole('dialog').getByText('Stake Program',{exact:true}).waitFor();
	});
	await test('permission request: desktop QR preserves payload', async () => {
		const {p}=await context('Mozilla/5.0 Windows');
		const link=requestLink({v:1,programs:[],limits:[]});
		await p.goto(link);
		await visible(p,'Open on your phone');
		await p.getByText(link,{exact:true}).waitFor();
		await p.screenshot({path:'/private/tmp/revibase-permissions-desktop.png'});
	});
	await test('expired session goes to recovery screen', async () => {
		const { c, p } = await context();
		await navigate(p);
		await c.clearCookies();
		await c.addCookies([{ name: 'simulation_session', value: 'expired', url: BASE }]);
		await p.goto(BASE + '/accessory');
		await p.waitForURL('**/tap/expired');
	});
} finally {
	await writeFile(
		new URL('report-' + (process.env.SIMULATION_ENGINE || 'chromium') + '.json', output),
		JSON.stringify({ engine: process.env.SIMULATION_ENGINE || 'chromium', results, pageErrors: errors }, null, 2)
	);
	for (const c of contexts) await c.close();
	await browser.close();
}
if (results.some((r) => r.status === 'failed') || errors.length) {
	console.error('Page errors:', errors);
	process.exitCode = 1;
}
console.log(results.filter((r) => r.status === 'passed').length + '/' + results.length + ' browser scenarios passed');
