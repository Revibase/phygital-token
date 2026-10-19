<script lang="ts">
	import { onMount } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import LogOut from '@lucide/svelte/icons/log-out';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import WalletAvatar from './WalletAvatar.svelte';
	import WalletConnect from './WalletConnect.svelte';
	import { walletStore, type Cluster } from '#lib/client/wallet/wallet.svelte.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';

	let { cluster, connect = true }: { cluster: Cluster; connect?: boolean } = $props();

	onMount(() => walletStore.init(cluster));

	let connecting = $state(false);
</script>

{#if walletStore.address}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			aria-label={`Wallet ${walletStore.address}`}
			class="inline-flex h-10 items-center gap-2 rounded-full border bg-card py-1 pr-3.5 pl-1.5 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-muted/60"
		>
			<WalletAvatar address={walletStore.address} size="sm" />
			<span class="font-mono text-[13px] font-medium">{shortAddress(walletStore.address)}</span>
			<ChevronDown class="size-3.5 text-muted-foreground" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="min-w-44">
			<DropdownMenu.Item>
				{#snippet child({ props })}<a {...props} href="/wallet"
						><WalletIcon class="size-4 shrink-0" />View wallet</a
					>{/snippet}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => void walletStore.disconnect()}
				><LogOut class="size-4 shrink-0" />Disconnect</DropdownMenu.Item
			>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{:else if connect && !walletStore.pending}
	<Button size="sm" class="h-10 rounded-full px-4" onclick={() => (connecting = true)}
		>Connect</Button
	>
{/if}
<WalletConnect bind:open={connecting} showButton={false} />
