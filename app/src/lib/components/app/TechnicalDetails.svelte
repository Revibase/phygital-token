<script lang="ts">
	import * as Drawer from '$lib/components/ui/drawer';
	import { Button } from '$lib/components/ui/button';
	import type { AccessoryView } from '$lib/shared/types';
	import InfoIcon from '@lucide/svelte/icons/info';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	let { accessory, cluster }: { accessory: AccessoryView; cluster: string } = $props();
	const explorer = (addr: string) =>
		`https://explorer.solana.com/address/${addr}${cluster === 'mainnet' ? '' : `?cluster=${cluster}`}`;
	const kindLabel = { permanent: 'Permanent', bearer: 'Transferable', controlled: 'Controlled', unknown: 'Unknown' };
	const rows = $derived([
		['Accessory account', accessory.pda],
		['Chip identifier', accessory.identifier],
		['Passkey', accessory.publicKey],
		['Type', kindLabel[accessory.kind]],
		['Locked', accessory.isLocked ? 'Yes' : 'No'],
		['Approvals used', String(accessory.lastSignCount)],
		['Linked wallet', accessory.linkedWallet ?? '—'],
		['Collectible', accessory.mint ?? '—']
	]);
</script>

<Drawer.Root>
	<Drawer.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" class="h-11 text-muted-foreground"><InfoIcon /> Technical details</Button>
		{/snippet}
	</Drawer.Trigger>
	<Drawer.Content>
		<div class="mx-auto w-full max-w-md px-4 pb-8">
			<Drawer.Header class="px-0">
				<Drawer.Title>Technical details</Drawer.Title>
				<Drawer.Description>On-chain record for this accessory.</Drawer.Description>
			</Drawer.Header>
			<dl class="divide-y rounded-xl border text-sm">
				{#each rows as [k, v] (k)}
					<div class="grid gap-1 p-3">
						<dt class="text-xs text-muted-foreground">{k}</dt>
						<dd class="font-mono text-xs break-all">{v}</dd>
					</div>
				{/each}
			</dl>
			<Button href={explorer(accessory.pda)} target="_blank" rel="noopener noreferrer" variant="outline" class="mt-4 w-full">
				View on explorer <ExternalLinkIcon />
			</Button>
		</div>
	</Drawer.Content>
</Drawer.Root>
