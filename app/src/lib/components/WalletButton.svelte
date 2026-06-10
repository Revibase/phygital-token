<script lang="ts">
	import { onMount } from 'svelte';
	import {
		availableWallets,
		connectWallet,
		disconnectWallet,
		initWallet,
		walletStore
	} from '$lib/wallet';
	import { shortenAddress } from '$lib/format';

	let showPicker = $state(false);

	onMount(async () => {
		await initWallet();
	});

	async function handleConnect(wallet: (typeof $availableWallets)[number]) {
		showPicker = false;
		await connectWallet(wallet);
	}

	async function handleDisconnect() {
		await disconnectWallet();
	}
</script>

<div class="wallet">
	{#if $walletStore.connected && $walletStore.account}
		<div class="connected">
			<span>{shortenAddress($walletStore.account.address)}</span>
			<button type="button" class="ghost" onclick={handleDisconnect}>Disconnect</button>
		</div>
	{:else}
		<button
			type="button"
			class="connect"
			disabled={$walletStore.connecting}
			onclick={() => (showPicker = !showPicker)}
		>
			{$walletStore.connecting ? 'Connecting…' : 'Connect wallet'}
		</button>
	{/if}

	{#if showPicker}
		<div class="picker" role="menu">
			{#if $availableWallets.length === 0}
				<p class="empty">No wallets detected. Open in a Solana mobile wallet browser.</p>
			{:else}
				{#each $availableWallets as wallet (wallet.name)}
					<button type="button" onclick={() => handleConnect(wallet)}>
						{wallet.name}
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
	.wallet {
		position: relative;
	}

	.connect,
	.ghost {
		border-radius: 999px;
		padding: 0.55rem 1rem;
		font-weight: 600;
		cursor: pointer;
	}

	.connect {
		border: 1px solid var(--border);
		background: var(--primary);
		color: var(--primary-foreground);
	}

	.connect:hover:not(:disabled) {
		opacity: 0.88;
	}

	.connected {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		background: var(--card);
		border: 1px solid var(--border);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.85rem;
		color: var(--foreground);
	}

	.ghost {
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
	}

	.ghost:hover {
		color: var(--foreground);
	}

	.picker {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 220px;
		padding: 0.5rem;
		border-radius: var(--radius);
		background: var(--popover);
		border: 1px solid var(--border);
		box-shadow: 0 16px 40px var(--shadow-color);
		z-index: 20;
	}

	.picker button {
		display: block;
		width: 100%;
		border: 0;
		border-radius: calc(var(--radius) - 2px);
		padding: 0.65rem 0.75rem;
		text-align: left;
		background: transparent;
		color: var(--popover-foreground);
		cursor: pointer;
	}

	.picker button:hover {
		background: var(--accent);
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
</style>
