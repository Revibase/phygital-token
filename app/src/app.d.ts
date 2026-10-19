declare global {
	namespace Cloudflare {
		/** Bindings `wrangler types` doesn't generate from wrangler.jsonc. */
		interface Env {
			/** Origin of the Revibase Pay app. Empty hides the built-in Pay shortcut. */
			PAY_APP_ORIGIN?: string;
		}
	}
}

export {};
