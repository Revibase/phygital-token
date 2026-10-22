import { env } from './cloudflare-workers';

/** Stand-in for OpenNext's request bindings. Tests mutate `cloudflare:workers` `env`. */
export function getCloudflareContext() {
	return Promise.resolve({ env, ctx: {}, cf: undefined });
}
