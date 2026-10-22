import type { AppBoot } from '#lib/client/boot';

import { getEnv, solanaCluster } from './env';

/** Public boot data for the browser. Secrets never leave the server. */
export async function loadBoot(): Promise<AppBoot> {
	const env = await getEnv();
	return {
		cluster: solanaCluster(env),
		rpcUrl: env.NEXT_PUBLIC_SOLANA_RPC_URL,
		privyAppId: env.NEXT_PUBLIC_PRIVY_APP_ID
	};
}
