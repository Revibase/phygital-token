<script lang="ts">
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import type { AccessoryView } from '#lib/shared/types.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import CopyButton from './CopyButton.svelte';
	import ExplorerLink from './ExplorerLink.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { accessoryMediaQuery } from '#lib/client/queries.ts';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { startAuthentication, verifyResponse, findPhygitalTokenPda } from 'phygital-token-sdk';
	import Notice from './Notice.svelte';
	import { canTapHere, tapHint } from '#lib/client/capability.ts';
	import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
	import { browserRpc } from '#lib/client/rpc.ts';

	let {
		accessory,
		cluster,
		open = $bindable(false)
	}: { accessory: AccessoryView; cluster: string; open?: boolean } = $props();

	const explorable = new Set(['Owner', 'NFT']);
	const lower = (label: string) => (label === 'NFT' ? label : label.toLowerCase());
	const mediaQuery = createQuery(() => ({
		...accessoryMediaQuery(accessory.pda),
		enabled: !!accessory.mint
	}));
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
			? 'Open this page in Safari or Chrome'
			: {
					idle: 'Hold it to your phone',
					tapping: tapHint(),
					genuine: 'Genuine, and in your hand',
					mismatch: 'That’s a different accessory'
				}[check]
	);
	async function runCheck() {
		check = 'tapping';
		checkFailure = null;
		try {
			const message = crypto.randomUUID();
			const response = await startAuthentication(message, { rpc: browserRpc() });
			const result = await verifyResponse({
				expectedMessage: message,
				expectedOrigin: location.origin,
				response
			});
			if (!result.isVerified) throw new Error('Signature did not verify');
			check =
				String(await findPhygitalTokenPda(result.secp256r1PublicKey)) === accessory.pda
					? 'genuine'
					: 'mismatch';
		} catch (err) {
			checkFailure = describeError(err, 'tap');
			check = 'idle';
		}
	}

	const kindLabel = {
		permanent: 'Permanent · its owner can’t change',
		bearer: 'Bearer · whoever holds it can claim it',
		controlled: 'Controlled · its owner releases it first',
		unknown: 'Unknown'
	};
	const copyable = $derived([
		['Public key', accessory.publicKey],
		['Owner', accessory.owner],
		['NFT', accessory.mint]
	] as const);
</script>

<ResponsiveSheet bind:open title="Accessory details">
	<List>
		<ListRow
			label="Check it’s genuine"
			detail={checkDetail}
			busy={check === 'tapping'}
			onclick={canCheck ? runCheck : undefined}
		>
			{#snippet trailing()}{#if check === 'genuine'}<CheckIcon
						class="animate-rise size-5 text-success"
					/>{:else if canCheck}<ChevronRightIcon
						class="size-4 text-muted-foreground/70"
					/>{/if}{/snippet}
		</ListRow>
	</List>
	<Notice error={checkFailure} />

	<List>
		<ListRow label="Type" detail={kindLabel[accessory.kind]} />
		<ListRow label="Status" detail={accessory.isLocked ? 'Locked' : 'Unlocked'} />
	</List>
	<List>
		{#each copyable as [label, value] (label)}
			<ListRow
				{label}
				detail={value
					? label === 'NFT' && collectibleName
						? `${collectibleName} · ${shortAddress(value)}`
						: shortAddress(value)
					: 'None'}
			>
				{#snippet trailing()}
					{#if value}
						<span class="flex items-center">
							{#if explorable.has(label)}
								<ExplorerLink {value} {cluster} label={`View ${lower(label)} on Solana Explorer`} />
							{/if}
							<CopyButton {value} label={`Copy ${lower(label)}`} />
						</span>
					{/if}
				{/snippet}
			</ListRow>
		{/each}
	</List>
</ResponsiveSheet>
