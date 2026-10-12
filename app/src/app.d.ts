declare global {
	/** Secrets (`wrangler secret put`, `.dev.vars`), which `wrangler types` doesn't generate. */
	interface Env {
		SESSION_SECRET: string;
		SPONSOR_KEYS?: string;
	}

	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties
		}
	}
}

export {};
