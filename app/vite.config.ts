import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		noExternal: ['phygital-nfts-client']
	},
	optimizeDeps: {
		include: [
			'buffer',
			'process',
			'@solana/kit',
			'@solana/connector',
			'@solana/web3.js',
			'@ardrive/turbo-sdk/web'
		],
		// Linked workspace package — exclude so Vite does not cache a stale prebundle.
		exclude: ['phygital-nfts-client']
	},
	define: {
		'process.env.BROWSER': 'true'
	},
	resolve: {
		alias: {
			buffer: 'buffer/',
			process: 'process/browser',
			crypto: path.resolve(appDir, 'node_modules/crypto-browserify/index.js'),
			stream: path.resolve(appDir, 'node_modules/stream-browserify/index.js'),
			'node:crypto': path.resolve(appDir, 'node_modules/crypto-browserify/index.js'),
			'node:stream': path.resolve(appDir, 'node_modules/stream-browserify/index.js')
		}
	}
});
