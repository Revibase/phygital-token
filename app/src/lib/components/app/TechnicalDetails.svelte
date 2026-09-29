<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import type { AccessoryView } from '$lib/shared/types';
	import { shortAddress } from '$lib/shared/encoding';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import CopyButton from './CopyButton.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { accessoryMediaQuery } from '$lib/client/queries';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { startAuthentication, verifyResponse, findPhygitalTokenPda } from 'phygital-token-sdk';
	import Notice from './Notice.svelte';
	import { canTapHere, tapHint } from '$lib/client/capability';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { browserRpc } from '$lib/client/rpc';

	let { accessory, cluster, open = $bindable(false) }: { accessory: AccessoryView; cluster: string; open?: boolean } = $props();

	const explorerUrl = (addr: string) =>
		`https://explorer.solana.com/address/${addr}${cluster === 'mainnet' ? '' : `?cluster=${cluster === 'localnet' ? 'custom' : cluster}`}`;
	/** Only these two are worth opening in an explorer; the token account and keys aren't. */
	const explorable = new Set(['Linked wallet', 'Collectible']);
	const mediaQuery = createQuery(() => ({ ...accessoryMediaQuery(accessory.pda), enabled: !!accessory.mint }));
	const media = $derived(mediaQuery.data ?? null);
	let showAllTraits = $state(false);
	const collectibleName = $derived(media?.name ?? null);
	const TRAITS_SHOWN = 6;
	const traits = $derived(media?.attributes ?? []);
	const visibleTraits = $derived(showAllTraits ? traits : traits.slice(0, TRAITS_SHOWN));
	$effect(() => {
		if (!open) showAllTraits = false;
	});
	type Check = 'idle' | 'tapping' | 'genuine' | 'mismatch';
	let check = $state<Check>('idle');
	let checkFailure = $state<FriendlyError | null>(null);
	const canCheck = canTapHere();
	$effect(() => {
		if (open) {
			check = 'idle';
			checkFailure = null;
		}
	});
	const checkDetail = $derived(
		!canCheck
			? 'Open in Safari or Chrome to read your accessory'
			: { idle: 'Tap it to your phone to prove it’s the real thing', tapping: tapHint(), genuine: 'Authentic, and here now', mismatch: 'That’s a different accessory' }[check]
	);
	async function runCheck() {
		check = 'tapping';
		checkFailure = null;
		try {
			const message = crypto.randomUUID();
			const response = await startAuthentication(message, { rpc: browserRpc() });
			const result = verifyResponse({ expectedMessage: message, response });
			if (!result.isVerified) throw new Error('Signature did not verify');
			check = String(await findPhygitalTokenPda(result.secp256r1PublicKey)) === accessory.pda ? 'genuine' : 'mismatch';
		} catch (err) {
			checkFailure = describeError(err, 'tap');
			check = 'idle';
		}
	}

	const kindLabel = { permanent: 'Bound to one wallet', bearer: 'Tradable', controlled: 'Locks to its owner', unknown: 'Unknown' };
	const copyable = $derived(
		[
			['Accessory account', accessory.pda],
			['Chip ID', accessory.identifier],
			['Passkey', accessory.publicKey],
			['Linked wallet', accessory.linkedWallet],
			['Collectible', accessory.mint]
		] as const
	);
</script>

<ResponsiveSheet bind:open title="Details" description="The on-chain record for this accessory.">
	<List>
		<ListRow label="Verify authenticity" detail={checkDetail} busy={check === 'tapping'} onclick={canCheck ? runCheck : undefined}>
			{#snippet trailing()}{#if check === 'genuine'}<CheckIcon class="animate-rise size-5 text-success" />{:else if canCheck}<ChevronRightIcon class="size-4 text-muted-foreground/70" />{/if}{/snippet}
		</ListRow>
	</List>
	{#if checkFailure}<Notice title={checkFailure.title} body={checkFailure.body} detail={checkFailure.detail} />{/if}
	{#if traits.length}
		<section class="space-y-2">
			<h3 class="px-1 text-[13px] font-medium text-muted-foreground">Traits</h3>
			<dl class="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] bg-border">
				{#each visibleTraits as t (t.label + t.value)}
					<div class="min-w-0 bg-card px-4 py-3">
						<dt class="truncate text-[12px] text-muted-foreground">{t.label}</dt>
						<dd class="truncate text-[15px] font-medium">{t.value}</dd>
					</div>
				{/each}
			</dl>
			{#if traits.length > TRAITS_SHOWN}
				<Button variant="ghost" class="h-10 w-full text-muted-foreground" onclick={() => (showAllTraits = !showAllTraits)}>
					{showAllTraits ? 'Show fewer' : `Show all ${traits.length}`}
				</Button>
			{/if}
		</section>
	{/if}
	<List>
		<ListRow label="Type" detail={kindLabel[accessory.kind]} />
		<ListRow label="Status" detail={accessory.isLocked ? 'Locked' : 'Unlocked'} />
		<ListRow label="Signature counter" detail={String(accessory.lastSignCount)} />
	</List>
	<List>
		{#each copyable as [label, value] (label)}
			<ListRow
				{label}
				detail={value
					? label === 'Collectible' && collectibleName
						? `${collectibleName} · ${shortAddress(value)}`
						: shortAddress(value)
					: 'None'}
			>
				{#snippet trailing()}
					{#if value}
						<span class="flex items-center">
							{#if explorable.has(label)}
								<a
									href={explorerUrl(value)}
									target="_blank"
									rel="noopener noreferrer"
									aria-label={`View ${label.toLowerCase()} on Solana Explorer`}
									class="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
								>
									<ArrowUpRightIcon class="size-4" />
								</a>
							{/if}
							<CopyButton {value} label={`Copy ${label.toLowerCase()}`} />
						</span>
					{/if}
				{/snippet}
			</ListRow>
		{/each}
	</List>
</ResponsiveSheet>
