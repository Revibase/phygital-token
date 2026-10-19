<script lang="ts">
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Copy from '@lucide/svelte/icons/copy';
	import WalletAvatar from './WalletAvatar.svelte';
	import { copyText } from '#lib/client/clipboard.ts';
	import { explorerUrl } from '#lib/shared/explorer.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';

	let { address, label, cluster }: { address: string; label: string; cluster: string } = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		aria-label={`${label}, ${address}. Wallet options`}
		class="mx-auto inline-flex h-11 max-w-full items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-muted/70"
	>
		<WalletAvatar {address} size="sm" />
		<span class="truncate text-[15px] font-medium">{label}</span>
		<span class="font-mono text-[13px] text-muted-foreground">{shortAddress(address)}</span>
		<ChevronDown class="size-4 shrink-0 text-muted-foreground" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="center" class="max-w-72">
		<DropdownMenu.Item onSelect={() => copyText(address, 'Wallet address copied')}
			><Copy class="size-4 shrink-0" />Copy address</DropdownMenu.Item
		>
		<DropdownMenu.Item>
			{#snippet child({ props })}<a
					{...props}
					href={explorerUrl('address', address, cluster)}
					target="_blank"
					rel="noopener noreferrer"><ArrowUpRight class="size-4 shrink-0" />View in explorer</a
				>{/snippet}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
