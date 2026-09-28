<script lang="ts">
	import * as Drawer from '$lib/components/ui/drawer';
	import type { AccessoryView } from '$lib/shared/types';
	import { shortAddress } from '$lib/shared/encoding';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import CopyButton from './CopyButton.svelte';
	import { accessoryMedia } from '$lib/client/media';

	/** For people who want the on-chain record. Short values, full value on copy. */
	let { accessory, cluster, open = $bindable(false) }: { accessory: AccessoryView; cluster: string; open?: boolean } = $props();

	const explorer = $derived(
		`https://explorer.solana.com/address/${accessory.pda}${cluster === 'mainnet' ? '' : `?cluster=${cluster === 'localnet' ? 'custom' : cluster}`}`
	);
	let collectibleName = $state<string | null>(null);
	$effect(() => {
		collectibleName = null;
		if (open && accessory.mint) void accessoryMedia(accessory.pda).then((m) => (collectibleName = m.name));
	});
	const kindLabel = { permanent: 'Permanent', bearer: 'Transferable', controlled: 'Controlled', unknown: 'Unknown' };
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

<Drawer.Root bind:open>
	<Drawer.Content>
		<div class="mx-auto w-full max-w-md space-y-5 px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<Drawer.Header class="p-0 text-left">
				<Drawer.Title class="text-[20px] font-semibold tracking-[-0.02em]">Details</Drawer.Title>
				<Drawer.Description class="text-[14px]">The on-chain record for this accessory.</Drawer.Description>
			</Drawer.Header>
			<List>
				<ListRow label="Type" detail={kindLabel[accessory.kind]} />
				<ListRow label="Status" detail={accessory.isLocked ? 'Locked' : 'Unlocked'} />
				<ListRow label="Approvals used" detail={String(accessory.lastSignCount)} />
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
						{#snippet trailing()}{#if value}<CopyButton {value} label={`Copy ${label.toLowerCase()}`} />{/if}{/snippet}
					</ListRow>
				{/each}
			</List>
			<List>
				<ListRow label="View on Solana Explorer" href={explorer} rel="noopener noreferrer" external />
			</List>
		</div>
	</Drawer.Content>
</Drawer.Root>
