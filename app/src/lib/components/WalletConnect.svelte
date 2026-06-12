<script lang="ts">
	import {
		availableConnectors,
		connectConnector,
		isWalletConnectConnector,
		walletConnectUri,
		walletReady,
		walletStore
	} from '$lib/wallet';
	import { shortenAddress } from '$lib/format';

	let {
		variant = 'inline'
	}: {
		variant?: 'inline' | 'compact';
	} = $props();

	let showPicker = $state(false);

	const connectors = $derived($availableConnectors);
	const extensionConnectors = $derived(connectors.filter((connector) => !isWalletConnectConnector(connector)));

	const connectLabel = $derived(
		$walletStore.connecting
			? $walletConnectUri
				? 'Scan QR code…'
				: 'Connecting…'
			: !$walletReady
				? 'Loading wallets…'
				: connectors.length === 0
					? 'No wallets available'
					: 'Connect wallet'
	);

	async function connectWith(connectorId: (typeof connectors)[number]['id']) {
		try {
			await connectConnector(connectorId);
		} catch {
			// Error is stored in walletStore for display.
		}
	}

	async function handleConnectClick() {
		if (connectors.length === 1) {
			await connectWith(connectors[0].id);
			return;
		}

		if (extensionConnectors.length === 1) {
			await connectWith(extensionConnectors[0].id);
			return;
		}

		showPicker = !showPicker;
	}
</script>

<div class="wallet-connect" class:compact={variant === 'compact'}>
	{#if $walletStore.connected && $walletStore.accountAddress}
		<div class="connected">
			<span>{shortenAddress($walletStore.accountAddress)}</span>
		</div>
	{:else}
		<button
			type="button"
			class="connect"
			disabled={$walletStore.connecting || !$walletReady || connectors.length === 0}
			onclick={handleConnectClick}
		>
			{connectLabel}
		</button>
	{/if}

	{#if $walletStore.connecting && $walletConnectUri}
		<p class="hint">Scan the QR code with your mobile wallet or approve the connection in your wallet app.</p>
	{/if}

	{#if showPicker}
		<div class="picker" role="menu">
			{#if connectors.length === 0}
				<p class="empty">
					Install Phantom or Solflare, or set PUBLIC_WALLETCONNECT_PROJECT_ID for mobile WalletConnect.
				</p>
			{:else}
				{#each connectors as connector (connector.id)}
					<button
						type="button"
						onclick={async () => {
							showPicker = false;
							await connectWith(connector.id);
						}}
					>
						{#if connector.icon}
							<img src={connector.icon} alt="" class="wallet-icon" />
						{/if}
						<span>{connector.name}</span>
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	{#if $walletStore.error}
		<p class="error">{$walletStore.error}</p>
	{/if}
</div>

<style>
	.wallet-connect {
		position: relative;
		width: 100%;
	}

	.connect {
		width: 100%;
		min-height: 48px;
		border-radius: var(--radius);
		padding: 0.85rem 1rem;
		font-weight: 600;
		border: 1px solid var(--border);
		background: var(--primary);
		color: var(--primary-foreground);
		cursor: pointer;
	}

	.connect:hover:not(:disabled) {
		opacity: 0.88;
	}

	.connected {
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		background: var(--card);
		border: 1px solid var(--border);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.85rem;
		color: var(--foreground);
		text-align: center;
	}

	.picker {
		margin-top: 0.5rem;
		padding: 0.5rem;
		border-radius: var(--radius);
		background: var(--popover);
		border: 1px solid var(--border);
	}

	.picker button {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		border: 0;
		border-radius: calc(var(--radius) - 2px);
		padding: 0.75rem;
		text-align: left;
		background: transparent;
		color: var(--popover-foreground);
		cursor: pointer;
		min-height: 44px;
	}

	.picker button:hover {
		background: var(--accent);
	}

	.wallet-icon {
		width: 24px;
		height: 24px;
		border-radius: 6px;
		flex-shrink: 0;
	}

	.hint {
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
		color: var(--muted-foreground);
		line-height: 1.4;
	}

	.empty,
	.error {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: var(--destructive);
	}

	.empty {
		color: var(--muted-foreground);
		padding: 0.5rem;
	}

	.compact .connect {
		width: auto;
		min-height: auto;
		padding: 0.55rem 1rem;
		border-radius: 999px;
	}
</style>
