import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			'#lib': `${appRoot}src/lib`,
			'@opennextjs/cloudflare': `${appRoot}test/support/opennext.ts`,
			'cloudflare:workers': `${appRoot}test/support/cloudflare-workers.ts`
		}
	},
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['test/**/*.test.ts']
	}
});
