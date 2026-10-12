<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { planFee, type AccessoryPolicy } from 'phygital-token-sdk';
	import { isSome } from '@solana/kit';
	import { toast } from 'svelte-sonner';
	import Notice from './Notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import { refillNetworkFees, sponsorQuery } from '$lib/client/accessory-wallet/submit';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { formatTokenAmount, SOL_DECIMALS } from '$lib/shared/amount';

	/** A typical tap's network fee, to tell whether the next one needs a refill. */
	const TAP_FEE_ESTIMATE = 30_000n;

	let { pda, policy }: { pda: string; policy: AccessoryPolicy | null } = $props();
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);

	const sponsor = createQuery(() => sponsorQuery(pda));

	/** Taps refill from the wallet, but only within their SOL limit: under it, they pause until the owner refills here. */
	const refill = $derived.by(() => {
		const p = sponsor.data?.prepaid;
		if (!p || !policy) return null;
		const { refill } = planFee({ balance: p.balanceLamports, prepaid: p.prepaidLamports, cost: TAP_FEE_ESTIMATE });
		if (refill === 0n) return null;
		const cap = isSome(policy.solCap) ? policy.solCap.value : null;
		const tapCanRefill = !!cap && cap.cap >= refill && (cap.maxPerTx === 0n || cap.maxPerTx >= refill);
		return tapCanRefill ? null : refill;
	});

	async function refillNow() {
		busy = true;
		failure = null;
		try {
			await refillNetworkFees(walletStore.signingContext(), pda);
			toast.success('Network fees topped up');
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

{#if refill !== null}
	<Notice tone="info" title="Top up fees to use tap signing" body="Tap signing needs a fee top-up from this wallet. You can still tap to sign in.">
		{#snippet actions()}
			<Button variant="secondary" class="w-full" disabled={busy} onclick={refillNow}>
				{#if busy}<Spinner /> {walletStore.approvePrompt}{:else}Top up {formatTokenAmount(refill, SOL_DECIMALS)} SOL{/if}
			</Button>
		{/snippet}
	</Notice>
	<Notice error={failure} />
{/if}
