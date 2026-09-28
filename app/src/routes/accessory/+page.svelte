<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import ErrorCard from '$lib/components/app/ErrorCard.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import StatusPill from '$lib/components/app/StatusPill.svelte';
	import TechnicalDetails from '$lib/components/app/TechnicalDetails.svelte';
	import WalletChip from '$lib/components/app/WalletChip.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import { rememberedWallet } from '$lib/client/memory';
	import LockIcon from '@lucide/svelte/icons/lock';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';

	let { data } = $props();
	const a = $derived(data.accessory);

	// "Linked wallet changed" is only knowable against what this device linked before.
	let remembered = $state<string | null>(null);
	$effect(() => {
		if (a) remembered = rememberedWallet(a.pda);
	});
	const changedElsewhere = $derived(!!a?.linkedWallet && !!remembered && remembered !== a.linkedWallet);
</script>

<svelte:head><title>Your accessory · Revibase</title></svelte:head>

<PageShell>
	{#if !a}
		<section class="flex flex-1 flex-col justify-center">
			<ErrorCard title="Connection problem" body="Your accessory is authentic, but we couldn’t load its status. Check your connection.">
				{#snippet actions()}
					<Button size="lg" class="h-12 rounded-xl" onclick={() => invalidateAll()}>Try again</Button>
				{/snippet}
			</ErrorCard>
		</section>
	{:else}
		<section class="flex flex-1 flex-col gap-8 pt-6">
			<div class="flex flex-col items-center gap-5 text-center">
				{#if a.linkedWallet}
					<BondVisual tag={a.tag} />
				{:else}
					<AccessoryMark tag={a.tag} state="verified" />
				{/if}
				<div class="animate-rise space-y-3">
					<div class="flex justify-center">
						<StatusPill tone="ok" label="Authentic" />
					</div>
					{#if a.status === 'ready_to_link'}
						<h1 class="text-3xl font-semibold">Your accessory is ready</h1>
						<p class="text-muted-foreground">Link your wallet once. After that, a tap is all it takes to be you.</p>
					{:else if a.status === 'linked' || a.status === 'linked_locked'}
						<h1 class="text-3xl font-semibold">{a.kind === 'permanent' ? 'Permanently yours' : 'Ready to use'}</h1>
						<p class="text-muted-foreground">This accessory carries your wallet identity.</p>
					{:else}
						<h1 class="text-2xl font-semibold">This accessory isn’t available</h1>
						<p class="text-muted-foreground">Its record is in an unexpected state. Please contact the issuer.</p>
					{/if}
				</div>
			</div>

			{#if changedElsewhere}
				<Alert.Root class="rounded-2xl">
					<ShieldCheckIcon />
					<Alert.Title>Linked to a different wallet now</Alert.Title>
					<Alert.Description>
						This accessory was linked to another wallet since you last used it here. If that wasn’t you, keep the accessory safe
						and link it again.
					</Alert.Description>
				</Alert.Root>
			{/if}

			{#if a.linkedWallet}
				<WalletChip address={a.linkedWallet} label="Linked wallet" />
			{/if}

			{#if a.linkedWallet && (a.kind === 'controlled' || a.kind === 'permanent')}
				<Card.Root class="rounded-2xl">
					<Card.Content class="flex flex-row gap-3 text-sm">
						<LockIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<p class="text-muted-foreground">
							{#if a.kind === 'permanent'}
								Fixed to this wallet forever. It can’t be released or linked to a different wallet.
							{:else}
								Locked to this wallet. To link a different wallet, release it from this one first.
							{/if}
						</p>
					</Card.Content>
				</Card.Root>
			{/if}
		</section>
	{/if}

	{#snippet footer()}
		{#if a}
			<div class="grid gap-2">
				{#if a.canLink}
					<Button href="/accessory/link" size="lg" class="h-14 rounded-xl text-base">
						{a.linkedWallet ? 'Link a different wallet' : 'Link wallet'}
						<ArrowRightIcon />
					</Button>
				{/if}
				{#if a.canRelease}
					<ReleaseSheet accessory={a} cluster={data.cluster} />
				{/if}
				<div class="flex justify-center"><TechnicalDetails accessory={a} cluster={data.cluster} /></div>
			</div>
		{/if}
	{/snippet}
</PageShell>
