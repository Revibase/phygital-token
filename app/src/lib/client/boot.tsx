'use client';

import { createContext, useContext } from 'react';

import type { Cluster } from './wallet/wallet';

export type AppBoot = {
	cluster: Cluster;
	rpcUrl: string;
	privyAppId: string;
};

const BootContext = createContext<AppBoot | null>(null);

export function BootProvider({ boot, children }: { boot: AppBoot; children: React.ReactNode }) {
	return <BootContext.Provider value={boot}>{children}</BootContext.Provider>;
}

export function useBoot(): AppBoot {
	const boot = useContext(BootContext);
	if (!boot) throw new Error('useBoot must be used inside BootProvider');
	return boot;
}
