/** Solana Explorer links for the cluster this deployment runs on. */
export function explorerUrl(kind: 'address' | 'tx', value: string, cluster: string): string {
	const query = cluster === 'mainnet' ? '' : `?cluster=${cluster === 'localnet' ? 'custom' : cluster}`;
	return `https://explorer.solana.com/${kind}/${value}${query}`;
}
