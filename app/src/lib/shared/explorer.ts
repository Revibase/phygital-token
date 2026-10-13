/** The network shown next to addresses, or null on mainnet. */
export function networkLabel(cluster: string | null | undefined): string | null {
	if (!cluster || cluster === 'mainnet' || cluster === 'mainnet-beta') return null;
	return cluster.charAt(0).toUpperCase() + cluster.slice(1);
}

/** Solana Explorer links for the cluster this deployment runs on. */
export function explorerUrl(kind: 'address' | 'tx', value: string, cluster: string): string {
	const query =
		cluster === 'mainnet' ? '' : `?cluster=${cluster === 'localnet' ? 'custom' : cluster}`;
	return `https://explorer.solana.com/${kind}/${value}${query}`;
}
