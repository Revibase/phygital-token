<script lang="ts">
	import { onMount } from 'svelte';
	import {
		availableWallets,
		connectWallet,
		initWallet,
		walletStore
	} from '$lib/wallet';
	import { shortenAddress } from '$lib/format';

	let {
		variant = 'inline'
	}: {
		variant?: 'inline' | 'compact';
	} = $props();

	let showPicker = $state(false);

	onMount(async () => {
		await initWallet();
	});
</script>

<div class="wallet-connect" class:compact={variant === 'compact'}>
	{#if $walletStore.connected && $walletStore.account}
		<div class="connected">
			<span>{shortenAddress($walletStore.account.address)}</span>
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
					<button
						type="button"
						onclick={async () => {
							showPicker = false;
							await connectWallet(wallet);
						}}
					>
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
		display: block;
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
