import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
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
async function verify(token, audience) {
	return (
		await fetch(BASE + '/__simulation/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token, audience })
		})
	).json();
}
async function walletRoute(c, cb) {
	const handle = (url) => {
		const u = new URL(url);
		cb?.({ wallet: u.host, target: decodeURIComponent(u.pathname.split('/browse/')[1]) });
	};
	for (const host of ['phantom.app', 'backpack.app', 'solflare.com'])
		await c.route(`https://${host}/**`, (r) => {
			handle(r.request().url());
			return r.fulfill({ contentType: 'text/html', body: '<h1>Simulated wallet handoff</h1>' });
		});
	// Inspect the real redirect endpoint before simulating the OS handoff. Routing redirect chains varies by engine.
	await c.route('**/shortcut/**', async (r) => {
		const response = await r.fetch({ maxRedirects: 0 });
		const to = response.headers().location;
		assert.ok(to && /phantom.app|backpack.app|solflare.com/.test(to));
		handle(to);
		return r.fulfill({ contentType: 'text/html', status: 200, body: '<h1>Simulated wallet handoff</h1>' });
	});
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
		await p.getByText('Owns NFT',{exact:true}).waitFor();
		await nft.getByText('So11…1112',{exact:true}).waitFor();
		await nft.getByText('4.20%',{exact:true}).waitFor();
		await nft.getByRole('link',{name:'View collection on Solana Explorer',exact:true}).waitFor();
		assert.equal(await nft.getByRole('button',{name:'Close',exact:true}).count(),0);
		await p.keyboard.press('Escape');
		await nft.waitFor({state:'hidden'});
		await p.getByRole('button',{name:'Details',exact:true}).click();
		const details=p.getByRole('dialog');
		assert.equal(await details.getByRole('heading',{name:'Traits',exact:true}).count(),0);
		assert.equal(await details.getByText('Trait 1',{exact:true}).count(),0);
		await details.getByText(kind==='controlled'?'Unlink before relinking':'Bound to one wallet',{exact:true}).waitFor();
		await details.getByText('Locked',{exact:true}).waitFor();
		await details.getByRole('link',{name:'View collectible on Solana Explorer',exact:true}).waitFor();
		await p.keyboard.press('Escape');
		await details.waitFor({state:'hidden'});
		await p.getByRole('button',{name:'Stake NFT',exact:true}).click();
		await p.getByRole('link',{name:'Open in browser',exact:true}).waitFor();
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
			if(viewport.width>=768){
				await close.waitFor();
				await close.click({trial:true});
				const box=await close.boundingBox();
				assert.ok(box.height>=44 && box.y>=0 && box.y+box.height<=viewport.height,JSON.stringify({viewport,box}));
			}else assert.equal(await close.count(),0);
			assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
			if(viewport.width>=768)await close.click();else await p.mouse.click(10,10);
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
	await test('desktop NFT dialog presents artwork and metadata', async () => {
		const {p}=await context('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130.0.0.0');
		await navigate(p);
		await p.getByRole('button',{name:'View NFT details',exact:true}).press('Enter');
		const dialog=p.getByRole('dialog');
		await dialog.getByText('Value 8',{exact:true}).waitFor();
		const image=dialog.getByRole('img',{name:'Simulation NFT',exact:true});
		await image.waitFor();
		assert.equal(await image.getAttribute('src'),'/icon-512.png');
		await dialog.getByRole('button',{name:'Close',exact:true}).click();
		await dialog.waitFor({state:'hidden'});
		await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='View NFT details');
	});
	await test('owner shows known app and original desktop context', async () => {
		const {c,p}=await context();
		await c.addCookies([{name:'simulation_kind',value:'controlled',url:BASE}]);
		await c.addInitScript(({wallet,pda}) => {
			localStorage.setItem('revibase:link-context:'+pda, JSON.stringify({wallet,app:'Phantom',source:'desktop'}));
			localStorage.setItem('revibase:wallet-app:'+pda, JSON.stringify({wallet,app:'Phantom',method:'wallet'}));
		},{wallet:OWNER,pda:'So11111111111111111111111111111111111111112'});
		await navigate(p);
		await p.getByText('Phantom · Linked from desktop',{exact:true}).waitFor();
		assert.equal(await p.locator('img[src="/wallets/phantom.svg"]').count(),1);
		await p.screenshot({path:'/private/tmp/revibase-saved-owner-page.png',fullPage:true});
	});
	await test('forget owner details preserves other accessories and requires selection for shortcuts and unlink', async () => {
		const {c,p}=await context();
		const pda='So11111111111111111111111111111111111111112';
		await c.addCookies([{name:'simulation_kind',value:'controlled',url:BASE}]);
		await c.addInitScript(({wallet,pda}) => {
			if (localStorage.getItem('revibase:choose-wallet:'+pda)) return;
			localStorage.setItem('revibase:linked:'+pda,wallet);
			localStorage.setItem('revibase:wallet-app:'+pda,JSON.stringify({pda,wallet,app:'Phantom',method:'wallet'}));
			localStorage.setItem('revibase:link-context:'+pda,JSON.stringify({pda,wallet,app:'Phantom',source:'wallet'}));
			localStorage.setItem('revibase:wallet-app:another',JSON.stringify({wallet:'another',app:'Backpack'}));
		},{wallet:OWNER,pda});
		await navigate(p);
		assert.equal(await p.getByRole('button',{name:'Change wallet',exact:true}).count(),0);
		await p.getByRole('button',{name:'Owner options',exact:true}).click();
		await p.getByRole('menuitem',{name:'Forget wallet preference',exact:true}).click();
		await p.getByRole('menuitem',{name:'Forget wallet preference',exact:true}).waitFor({state:'hidden'});
		assert.notEqual(await p.evaluate(() => localStorage.getItem('revibase:wallet-app:another')),null);
		assert.equal(await p.evaluate(pda => localStorage.getItem('revibase:linked:'+pda),pda),OWNER);
		await p.getByRole('button',{name:'Stake NFT',exact:true}).click();
		await p.getByRole('link',{name:'Open in browser',exact:true}).waitFor();
		await p.keyboard.press('Escape');
		await p.getByRole('button',{name:'Unlink from wallet',exact:true}).click();
		await p.getByRole('link',{name:'Open in Backpack',exact:true}).waitFor();
		assert.equal(await p.getByRole('link',{name:'Open in Phantom to unlink',exact:true}).count(),0);
		await p.keyboard.press('Escape');
		await p.reload();
		await p.getByRole('button',{name:'Stake NFT',exact:true}).waitFor();
		await p.getByRole('button',{name:'Owner options',exact:true}).click();
		assert.equal(await p.getByRole('menuitem',{name:'Forget wallet preference',exact:true}).count(),0);
		await p.getByRole('menuitem',{name:'Copy wallet address',exact:true}).waitFor();
		await p.keyboard.press('Escape');
	});
	await test('unlink routes to saved wallet and reconnects without the original tap session', async () => {
		const {c,p}=await context();
		await c.addCookies([{name:'simulation_kind',value:'controlled',url:BASE}]);
		await c.addInitScript(({wallet,pda}) => localStorage.setItem('revibase:link-context:'+pda,JSON.stringify({wallet,app:'Phantom',source:'wallet'})), {wallet:OWNER,pda:'So11111111111111111111111111111111111111112'});
		await navigate(p);
		await p.getByRole('button',{name:'Unlink from wallet',exact:true}).click();
		await p.screenshot({path:'/private/tmp/revibase-unlink-saved-wallet.png'});
		const href=await p.getByRole('link',{name:'Open in Phantom to unlink',exact:true}).getAttribute('href');
		const target=decodeURIComponent(new URL(href).pathname.split('/browse/')[1]);
		assert.equal(target,BASE+'/unlink/So11111111111111111111111111111111111111112');
		await p.getByRole('button',{name:'Use a different wallet',exact:true}).click();
		await p.getByRole('link',{name:'Open in Backpack',exact:true}).waitFor();
		await p.screenshot({path:'/private/tmp/revibase-unlink-manual-wallet.png'});
		const wallet=await context(IOS+' Phantom');
		await wallet.c.clearCookies();
		await wallet.p.goto(target);
		await wallet.p.getByRole('button',{name:'Phantom',exact:true}).click();
		await wallet.p.getByRole('button',{name:'Unlink accessory',exact:true}).waitFor();
		assert.equal(await wallet.p.getByRole('button',{name:'Unlink accessory',exact:true}).isEnabled(),true);
		await wallet.p.evaluate(() => window.dispatchEvent(new CustomEvent('simulation:account',{detail:'So11111111111111111111111111111111111111112'})));
		await visible(wallet.p,'This isn’t the owner wallet');
		assert.equal(await wallet.p.getByRole('button',{name:'Unlink accessory',exact:true}).count(),0);
	});
	await test('stale wallet information clears when returning to a browser after relinking elsewhere', async () => {
		const {c,p}=await context();
		const pda='So11111111111111111111111111111111111111112';
		await c.addInitScript(({wallet,pda}) => {
			localStorage.setItem('revibase:linked:'+pda,wallet);
			localStorage.setItem('revibase:wallet-app:'+pda,JSON.stringify({pda,wallet,app:'Phantom',method:'wallet'}));
			localStorage.setItem('revibase:link-context:'+pda,JSON.stringify({pda,wallet,app:'Phantom',source:'desktop'}));
			localStorage.setItem('revibase:recent-wallet','Phantom');
			localStorage.setItem('revibase:connection-method','wallet');
		}, {wallet:OWNER,pda});
		await navigate(p);
		await visible(p,'Phantom · Linked from desktop');
		await c.addCookies([{name:'simulation_owner',value:pda,url:BASE}]);
		await p.evaluate(() => window.dispatchEvent(new Event('focus')));
		await p.waitForFunction(pda => localStorage.getItem('revibase:linked:'+pda)===null,pda);
		assert.deepEqual(await p.evaluate(pda => ['revibase:linked:'+pda,'revibase:wallet-app:'+pda,'revibase:link-context:'+pda,'revibase:recent-wallet','revibase:connection-method'].map(k=>localStorage.getItem(k)),pda),[null,null,null,null,null]);
		assert.equal(await p.getByText('Phantom · Linked from desktop',{exact:true}).count(),0);
	});
	await test('controlled: no mint skips metadata and shortcut requests', async () => {
		const {c,p} = await context();
		await c.addCookies([{name:'simulation_kind',value:'controlled',url:BASE},{name:'simulation_mint',value:'none',url:BASE}]);
		const requests=[];
		p.on('request',r=>{if (/\/api\/accessory\/(media|shortcuts)/.test(r.url())) requests.push(r.url());});
		await p.goto(BASE+'/accessory');
		await p.getByRole('button',{name:'Details',exact:true}).waitFor();
		assert.equal(await p.getByRole('heading',{name:'Simulation NFT',exact:true}).count(),0);
		assert.equal(await p.getByText('Stake NFT',{exact:true}).count(),0);
		assert.deepEqual(requests,[]);
	});
	await test('desktop opens new tab with fresh origin-bound third-party proof', async () => {
		const { c, p } = await context('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130.0.0.0');
		const tokens = [];
		await c.route('https://staking.example/**', (r) => {
			tokens.push(new URL(r.request().url()).searchParams.get('revibase_session'));
			return r.fulfill({ contentType: 'text/html', body: '<h1>Staking site</h1>' });
		});
		await navigate(p);
		const next = c.waitForEvent('page');
		await p.getByRole('link', { name: 'Stake NFT', exact: true }).click();
		await (await next).waitForURL('https://staking.example/**');
		assert.equal(p.url(), BASE + '/accessory');
		const claims = await verify(tokens[0], 'https://staking.example');
		assert.equal(claims.wallet, OWNER);
		assert.equal(await verify(tokens[0], 'https://project.example'), null);
		const again = c.waitForEvent('page');
		await p.getByRole('link', { name: 'Stake NFT', exact: true }).click();
		await (await again).waitForURL('https://staking.example/**');
		assert.notEqual(tokens[0], tokens[1]);
	});
	for (const [name, ua] of [
		['iOS Safari', IOS],
		['Android Chrome', ANDROID]
	])
		await test(name + ': picker persistence, wallet change, same versus new browser', async () => {
			const { c, p } = await context(ua);
			let opened;
			await walletRoute(c, (v) => (opened = v));
			await navigate(p);
			await p.getByRole('button', { name: 'Stake NFT', exact: true }).click();
			await p.getByRole('link', { name: 'Open in Phantom' }).click();
			await visible(p, 'Simulated wallet handoff');
			assert.equal(opened.wallet, 'phantom.app');
			assert.equal(
				(await verify(new URL(opened.target).searchParams.get('revibase_session'), 'https://staking.example')).authentication,
				'accessory'
			);
			await navigate(p);
			await p.getByRole('link', {name:'Stake NFT',exact:true}).waitFor();
			await p.getByRole('button',{name:'Owner options',exact:true}).click();
		await p.getByRole('menuitem',{name:'Forget wallet preference',exact:true}).click();
		await p.getByRole('button',{name:'Stake NFT',exact:true}).click();
			await p.getByRole('link', { name: 'Open in Backpack' }).click();
			await visible(p, 'Simulated wallet handoff');
			assert.equal(opened.wallet, 'backpack.app');
			await navigate(p);
			await p.getByRole('link', {name:'Stake NFT',exact:true}).waitFor();
			await p.screenshot({ path: new URL(name.split(' ')[0] + '-shortcuts.png', output).pathname });
			const reused = await context(ua, await c.storageState());
			await navigate(reused.p);
			await reused.p.getByRole('link', {name:'Stake NFT',exact:true}).waitFor();
			const fresh = await context(ua);
			await navigate(fresh.p);
			assert.equal(await fresh.p.getByRole('button', { name: 'Stake NFT', exact: true }).count(), 1);
		});
	for (const ua of [IOS, ANDROID]) {
	await test((ua === IOS ? 'iOS' : 'Android') + ': browser connection opens wallet shortcut in browser', async () => {
		const {c, p} = await context(ua);
		await c.route('https://staking.example/**', (r) => r.fulfill({contentType: 'text/html', body: '<h1>Staking site</h1>'}));
		await c.addInitScript(() => {
			localStorage.setItem('revibase:recent-wallet', 'Phantom');
			localStorage.setItem('revibase:connection-method', 'browser');
		});
		await navigate(p);
		assert.equal(await p.getByRole('link', {name:'Stake NFT', exact:true}).getAttribute('target'), '_blank');
		const popup = p.waitForEvent('popup');
		await p.getByRole('link', {name:'Stake NFT', exact:true}).click();
		const next = await popup;
		await next.waitForURL('https://staking.example/**');
		assert.equal(new URL(next.url()).searchParams.has('revibase_session'), true);
	});
}
	await test('fresh mobile browser can choose browser and reuse the choice', async () => {
		const {c,p} = await context();
		await c.route('https://staking.example/**', (r) => r.fulfill({contentType:'text/html', body:'<h1>Staking site</h1>'}));
		await navigate(p);
		await p.getByRole('button', {name:'Stake NFT', exact:true}).click();
		const popup = p.waitForEvent('popup');
		await p.getByRole('link', {name:'Open in browser', exact:true}).click();
		await (await popup).waitForURL('https://staking.example/**');
		assert.equal(await p.evaluate(() => localStorage.getItem('revibase:connection-method')), 'browser');
		await p.reload();
		await visible(p,'Stake NFT');
		assert.equal(await p.getByRole('link', {name:'Stake NFT', exact:true}).getAttribute('target'),'_blank');
	});
	await test('wallet browser stays in place despite another remembered wallet', async () => {
		const { c, p } = await context(IOS + ' Phantom');
		await c.addInitScript(() => {
			if (location.hostname === 'localhost') localStorage.setItem('revibase:recent-wallet', 'Backpack');
		});
		await c.route('https://staking.example/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Staking site</h1>' }));
		await navigate(p);
		assert.equal(await p.getByRole('button', { name: 'Change wallet', exact: true }).count(), 0);
		await p.getByRole('link', { name: 'Stake NFT', exact: true }).click();
		await visible(p, 'Staking site');
		assert.ok(p.url().startsWith('https://staking.example/'));
		assert.equal(c.pages().length, 1);
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
	await test('embed renders its frame in our app', async () => {
		const { p } = await context();
		await navigate(p);
		await p.getByRole('link', { name: 'Play', exact: true }).click();
		await p.locator('iframe').waitFor();
		assert.equal(p.url(), BASE + '/accessory/app/0');
		await p.frameLocator('iframe').getByText('Project experience').waitFor();
		await p.screenshot({ path: new URL('embedded.png', output).pathname });
	});
	await test('Safari handoff survives reload, remote completion and visibility return', async () => {
		await fetch(BASE + '/__simulation/reset', { method: 'POST' });
		const safari = await context();
		await safari.p.goto(BASE + '/accessory/link');
		await safari.p.getByRole('button', { name: 'Approve', exact: true }).click();
		await safari.p.getByRole('link', { name: 'Open in Phantom' }).waitFor();
		assert.ok(safari.p.url().includes('link=simulation-intent-0001'));
		await safari.p.reload();
		await safari.p.getByRole('link', { name: 'Open in Phantom' }).waitFor();
		const href = await safari.p.getByRole('link', { name: 'Open in Phantom' }).getAttribute('href');
		const target = decodeURIComponent(new URL(href).pathname.split('/browse/')[1]);
		assert.ok(target.includes('#h=simulation-handoff'));
		let background = true;
		await safari.c.route('**/api/link/simulation-intent-0001', (r) =>
			background ? r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : r.continue()
		);
		await safari.p.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
			document.dispatchEvent(new Event('visibilitychange'));
		});
		const wallet = await context(IOS + ' Phantom');
		await wallet.p.goto(target);
		await wallet.p.getByRole('button', { name: 'Phantom', exact: true }).click();
		await wallet.p.reload();
		await wallet.p.getByRole('button', { name: 'Phantom', exact: true }).click();
		await wallet.p.getByRole('button', { name: 'Link wallet', exact: true }).click();
		await visible(wallet.p, 'Wallet linked');
		assert.equal(await wallet.p.evaluate(() => localStorage.getItem('revibase:recent-wallet')), 'Phantom');
		assert.equal(await wallet.p.evaluate(() => localStorage.getItem('revibase:connection-method')), 'wallet');
		assert.equal(await wallet.p.evaluate(() => JSON.parse(localStorage.getItem('revibase:link-context:So11111111111111111111111111111111111111112')).source), 'wallet');
		background = false;
		await safari.p.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await visible(safari.p, 'Done');
		assert.equal(await safari.p.evaluate(() => localStorage.getItem('revibase:recent-wallet')), 'Phantom');
		assert.equal(await safari.p.evaluate(() => sessionStorage.getItem('revibase:handoff:simulation-intent-0001')), null);
		await safari.p.reload();
		await visible(safari.p, 'Done');
		await safari.p.getByRole('link', { name: 'Done', exact: true }).click();
		await safari.p.getByRole('link', {name:'Stake NFT',exact:true}).waitFor();
		const stranger = await context();
		assert.equal((await stranger.c.request.get(BASE + '/api/link/simulation-intent-0001')).status(), 403);
	});
	await test('detected Phantom connects in the regular browser and preserves that method after reload', async () => {
		await fetch(BASE + '/__simulation/reset', {method:'POST'});
		const {c, p} = await context(ANDROID);
		await c.addInitScript(() => localStorage.setItem('simulation:browser-wallet', 'true'));
		await p.goto(BASE + '/accessory/link');
		await p.getByRole('button', {name:'Approve', exact:true}).click();
		await p.getByRole('button', {name:'Phantom', exact:true}).click();
		await p.getByRole('button', {name:'Link wallet', exact:true}).click();
		await visible(p, 'Done');
		assert.equal(await p.evaluate(() => localStorage.getItem('revibase:connection-method')), 'browser');
		await p.reload();
		await visible(p, 'Done');
		assert.equal(await p.evaluate(() => localStorage.getItem('revibase:connection-method')), 'browser');
		await p.getByRole('link', {name:'Done', exact:true}).click();
		await visible(p, 'Stake NFT');
		assert.equal(await p.getByRole('link', {name:'Stake NFT', exact:true}).getAttribute('target'), '_blank');
	});
	await test('staking fixture checks account mismatch and signature rejection/retry', async () => {
		const { c, p } = await context(IOS + ' Phantom');
		const used = new Set();
		await c.route('https://staking.example/**', async (r) => {
			const u = new URL(r.request().url());
			if (u.pathname === '/__session') {
				const claims = await verify(u.searchParams.get('token'), 'https://staking.example');
				const valid = claims && !used.has(claims.jti);
				if (valid) used.add(claims.jti);
				return r.fulfill({ contentType: 'application/json', body: JSON.stringify(valid ? claims : null) });
			}
			return r.fulfill({
				contentType: 'text/html',
				body: await readFile(new URL('../test/browser/staking.html', import.meta.url), 'utf8')
			});
		});
		await navigate(p);
		await p.getByRole('link', { name: 'Stake NFT', exact: true }).click();
		await visible(p, 'Connect your wallet');
		await p.getByRole('button', { name: 'Connect wallet', exact: true }).click();
		await visible(p, 'Switch to the owner wallet to stake');
		assert.equal(await p.getByRole('button', { name: 'Stake NFT', exact: true }).isDisabled(), true);
		await p.getByRole('button', { name: 'Switch to linked account' }).click();
		await visible(p, 'Ready to stake');
		await p.getByRole('button', { name: 'Reject next signature' }).click();
		await p.getByRole('button', { name: 'Stake NFT', exact: true }).click();
		await visible(p, 'Signature rejected; try again');
		await p.getByRole('button', { name: 'Stake NFT', exact: true }).click();
		await visible(p, 'Staking transaction approved');
		await p.reload();
		await visible(p, 'No valid accessory session');
		assert.equal(await p.getByRole('button', { name: 'Stake NFT', exact: true }).isDisabled(), true);
	});
	await test('linking rejection is recoverable without completing the link', async () => {
		await fetch(BASE + '/__simulation/reset', { method: 'POST' });
		const safari = await context();
		await safari.p.goto(BASE + '/accessory/link');
		await safari.p.getByRole('button', { name: 'Approve', exact: true }).click();
		await safari.p.getByRole('link', { name: 'Open in Phantom' }).waitFor();
		const wallet = await context(IOS + ' Phantom');
		await wallet.p.goto(BASE + '/continue#h=simulation-handoff');
		await wallet.p.getByRole('button', { name: 'Phantom', exact: true }).click();
		await wallet.p.evaluate(() => sessionStorage.setItem('simulation:reject', 'true'));
		await wallet.p.getByRole('button', { name: 'Link wallet', exact: true }).click();
		assert.equal((await (await fetch(BASE + '/__simulation/status')).json()).state, 'claimed');
		await wallet.p.evaluate(() => sessionStorage.removeItem('simulation:reject'));
		await wallet.p.getByRole('button', { name: 'Link wallet', exact: true }).click();
		await visible(wallet.p, 'Wallet linked');
	});
	await test('unavailable wallet allows returning, copying the URL and choosing Solflare', async () => {
		const { c, p } = await context();
		await c.addInitScript(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					async writeText(value) {
						window.__copiedWebsite = value;
					}
				}
			});
		});
		await c.route('**/shortcut/**', async (r) => {
			const response = await r.fetch({ maxRedirects: 0 });
			assert.ok(response.headers().location.startsWith('https://phantom.app/'));
			return r.fulfill({ contentType: 'text/html', status: 200, body: '<h1>Wallet unavailable</h1>' });
		});
		await navigate(p);
		await p.getByRole('button', { name: 'Stake NFT', exact: true }).click();
		await p.getByRole('link', { name: 'Open in Phantom' }).click();
		await visible(p, 'Wallet unavailable');
		await p.goBack();
		await p.getByRole('link', {name:'Stake NFT',exact:true}).waitFor();
		await p.getByRole('button',{name:'Owner options',exact:true}).click();
		await p.getByRole('menuitem',{name:'Forget wallet preference',exact:true}).click();
		await p.getByRole('button',{name:'Stake NFT',exact:true}).click();
		await p.getByRole('button', { name: 'Copy website link' }).click();
		assert.equal(await p.evaluate(() => window.__copiedWebsite), 'https://staking.example/stake');
		await c.unroute('**/shortcut/**');
		let target;
		await walletRoute(c, (v) => (target = v));
		await p.getByRole('link', { name: 'Open in Solflare' }).click();
		await visible(p, 'Simulated wallet handoff');
		assert.equal(target.wallet, 'solflare.com');
		await navigate(p);
		await p.getByRole('link', {name:'Stake NFT',exact:true}).waitFor();
	});

	for (const ua of [IOS, 'Mozilla/5.0 Desktop']) {
		await test('Solana Pay fallback on ' + (ua === IOS ? 'mobile' : 'desktop'), async () => {
			const { c, p } = await context(ua);
			const href = 'solana:https%3A%2F%2Fmerchant.example%2Fpay%3Forder%3D123';
			await c.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__copiedPayment = value; } } }));
			await c.route('**/api/accessory/shortcuts**', r => r.fulfill({contentType:'application/json',body:JSON.stringify({shortcuts:[{label:'Pay',href,icon:'tip',image:null,immerse:false,proof:false,external:true,platform:'all'}]})}));
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
	await test('expired session goes to recovery screen', async () => {
		const { c, p } = await context();
		await navigate(p);
		await c.clearCookies();
		await p.getByRole('button', { name: 'Stake NFT', exact: true }).click();
		await p.getByRole('link', { name: 'Open in Phantom' }).click();
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
