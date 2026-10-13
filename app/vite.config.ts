import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url)).replaceAll('\\', '/');

// `REVIBASE_PLATFORM=e2e vite dev` runs against the end-to-end stack's bindings
// (test/e2e/wrangler.jsonc) instead of .dev.vars, over HTTPS with the
// certificate scripts/e2e-setup.ts generates; dev only, ignored by builds.
const e2e = process.env.REVIBASE_PLATFORM === 'e2e';
const platformProxy = e2e ? { configPath: appRoot + 'test/e2e/wrangler.jsonc', persist: { path: appRoot + '.wrangler/e2e/v3' } } : undefined;
// The local validator is plain HTTP, which an HTTPS page may not call (WebKit blocks it as
// mixed content), so the e2e server also serves it at /__e2e/rpc.
const e2eServer = e2e
	? {
			https: { cert: readFileSync(appRoot + '.wrangler/e2e/tls/cert.pem'), key: readFileSync(appRoot + '.wrangler/e2e/tls/key.pem') },
			proxy: { '/__e2e/rpc': { target: 'http://127.0.0.1:8899', changeOrigin: true, rewrite: () => '/' } },
			// The run writes screenshots and D1 state here; a reload mid-flow would abort it.
			watch: { ignored: ['**/test/e2e/results/**', '**/.wrangler/**', '**/scripts/**'] }
		}
	: undefined;

export default defineConfig(({ mode }) => ({
	// Codama-generated SDK modules read process.env.NODE_ENV at import time.
	define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
	server: e2eServer,
	plugins: [
		{
			name: 'exclude-test-code',
			apply: 'build',
			enforce: 'pre',
			load(id) {
				const path = id.split('?')[0].replaceAll('\\', '/');
				if (!path.startsWith(appRoot) || path.includes('/node_modules/')) return;
				const relative = path.slice(appRoot.length);
				if (/^(test|scripts)\//.test(relative) || /\.(test|spec)\.[^/]+$/.test(relative) || relative === 'vite.browser-simulation.config.ts')
					this.error(`Test-only code cannot be bundled for production: ${relative}`);
			}
		},
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: adapter({ platformProxy }),
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					// bits-ui / vaul position overlays with inline styles.
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'https:'],
					'font-src': ['self', 'data:'],
					// Mobile Wallet Adapter talks to the wallet over a local websocket.
					// The RPC proxy (SOLANA_RPC_URL) is called from the browser; a local validator is plain http.
					'connect-src': ['self', 'https:', 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*', 'wss:'],
					'frame-ancestors': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'object-src': ['none']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['test/**/*.test.ts'],
				}
			}
		]
	}
}));
