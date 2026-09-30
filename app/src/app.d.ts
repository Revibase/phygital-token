declare global {
	/** Secrets (`wrangler secret put`, `.dev.vars`), which `wrangler types` doesn't generate. */
	interface Env {
		SESSION_SECRET: string;
		SESSION_PROOF_KEY?: string;
	}

	namespace App {
		interface Locals {
			/** Set by `/accessory/app/[n]`: the one origin its page may frame (added to CSP `frame-src`). */
			frameSrc?: string;
		}
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties
		}
	}
}

export {};
