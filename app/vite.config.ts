import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(({ mode }) => ({
	// Codama-generated SDK modules read process.env.NODE_ENV at import time.
	define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: adapter(),
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
