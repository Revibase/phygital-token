<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import Notice from './Notice.svelte';
	import ReceiveSheet from './ReceiveSheet.svelte';
	import { Button } from '$lib/components/ui/button';
	import { feePreviewQuery } from '$lib/client/queries';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { formatTokenAmount, SOL_DECIMALS } from '$lib/shared/amount';

	/** Where this accessory's next network fee comes from, shown before approving. */
	let { pda, drainsWallet = false }: { pda: string; drainsWallet?: boolean } = $props();
	let receiveOpen = $state(false);

	const source = createQuery(() => feePreviewQuery(pda, walletStore.address, drainsWallet));
	const sol = (lamports: bigint) => formatTokenAmount(lamports, SOL_DECIMALS);
</script>

{#if source.data?.kind === 'owner'}
	<p class="px-1 text-[13px] text-muted-foreground">Network fee: paid by owner</p>
{:else if source.data?.kind === 'free'}
	<p class="px-1 text-[13px] text-muted-foreground">Network fee: covered</p>
{:else if source.data?.kind === 'refill'}
	<p class="px-1 text-[13px] leading-snug text-muted-foreground">
		Fee top-up: {sol(source.data.lamports)} SOL from the accessory wallet.
	</p>
{:else if source.data?.kind === 'blocked'}
	{@const blocked = source.data}
	<Notice
		tone="info"
		title={blocked.reason === 'accessory'
			? 'Add SOL to the accessory wallet'
			: 'Add SOL to the owner’s account'}
		body={blocked.reason === 'accessory'
			? `This wallet needs a fee top-up. Send at least ${sol(blocked.neededLamports)} SOL to the accessory wallet to keep going.`
			: `Send at least ${sol(blocked.neededLamports)} SOL to the owner’s account to pay the network fee.`}
	>
		{#snippet actions()}<Button
				variant="secondary"
				class="w-full"
				onclick={() => (receiveOpen = true)}>Receive SOL</Button
			>{/snippet}
	</Notice>
	<ReceiveSheet
		bind:open={receiveOpen}
		address={blocked.address}
		cluster={page.data.cluster}
		description={blocked.reason === 'accessory'
			? 'Send SOL on Solana to the accessory wallet.'
			: 'Send SOL on Solana to the owner’s account.'}
	/>
{/if}
