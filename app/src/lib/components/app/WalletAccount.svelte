<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import WalletAvatar from './WalletAvatar.svelte';
	import { copyText } from '#lib/client/clipboard.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';

	let { address, label }: { address: string; label: string } = $props();
</script>

<button
	type="button"
	aria-label={`${label}, ${address}. Copy address`}
	onclick={() => copyText(address, 'Wallet address copied')}
	class="mx-auto inline-flex h-11 max-w-full items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 active:bg-muted"
>
	<WalletAvatar size="sm" />
	<span class="font-mono text-[14px] font-medium">{shortAddress(address)}</span>
	<Copy class="size-4 shrink-0 text-muted-foreground" />
</button>
