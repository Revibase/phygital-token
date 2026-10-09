<script lang="ts">
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import type { AccessoryView } from '$lib/shared/types';
	import { shortAddress } from '$lib/shared/encoding';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import CopyButton from './CopyButton.svelte';
	import ExplorerLink from './ExplorerLink.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { accessoryMediaQuery } from '$lib/client/queries';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { startAuthentication, verifyResponse, findPhygitalTokenPda } from 'phygital-token-sdk';
	import Notice from './Notice.svelte';
	import { canTapHere, tapHint } from '$lib/client/capability';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { browserRpc } from '$lib/client/rpc';

	let { accessory, cluster, open = $bindable(false) }: { accessory: AccessoryView; cluster: string; open?: boolean } = $props();

	const explorable = new Set(['Linked wallet', 'Collectible']);
	const mediaQuery = createQuery(() => ({ ...accessoryMediaQuery(accessory.pda), enabled: !!accessory.mint }));
	const media = $derived(mediaQuery.data ?? null);
	const collectibleName = $derived(media?.name ?? null);
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

	const kindLabel = { permanent: 'Bound to one wallet', bearer: 'Relinkable while unlocked', controlled: 'Unlink before relinking', unknown: 'Unknown' };
	const copyable = $derived(
		[
			['Public Key', accessory.publicKey],
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

	<List>
		<ListRow label="Type" detail={kindLabel[accessory.kind]} />
		<ListRow label="Status" detail={accessory.isLocked ? 'Locked' : 'Unlocked'} />
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
								<ExplorerLink {value} {cluster} label={`View ${label.toLowerCase()} on Solana Explorer`} />
							{/if}
							<CopyButton {value} label={`Copy ${label.toLowerCase()}`} />
						</span>
					{/if}
				{/snippet}
			</ListRow>
		{/each}
	</List>
</ResponsiveSheet>
