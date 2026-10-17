declare global {
	/** Secrets (`wrangler secret put`, `.dev.vars`), which `wrangler types` doesn't generate. */
	interface Env {
		SESSION_SECRET: string;
		/** Origin of the Revibase Pay app. Empty hides the built-in Pay shortcut. */
		PAY_APP_ORIGIN?: string;
	}

	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}
	}
}

export {};
