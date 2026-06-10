import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		noExternal: ['phygital-nfts-client']
	},
	optimizeDeps: {
		include: ['buffer', '@solana/kit', 'phygital-nfts-client']
	},
	define: {
		'process.env.BROWSER': 'true'
	},
	resolve: {
		alias: {
			buffer: 'buffer/'
		}
	}
});
