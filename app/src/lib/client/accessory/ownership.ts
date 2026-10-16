export function isConnectedAccessoryOwner(owner: string | null | undefined, connected: string | null) {
	return !!owner && !!connected && owner === connected;
}
