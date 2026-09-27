<script lang="ts">
	import AccessoryMark from './AccessoryMark.svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	let { tag }: { tag: string } = $props();
</script>

<!-- Accessory ↔ Wallet: the one idea the product is about. -->
<div class="flex items-center justify-center gap-3" aria-hidden="true">
	<AccessoryMark {tag} state="linked" size="sm" />
	<div class="relative h-0.5 w-16 overflow-hidden rounded-full bg-border">
		<span class="animate-bond absolute inset-0 bg-gradient-to-r from-primary to-success"></span>
	</div>
	<div class="grid size-16 place-items-center rounded-[32%] border bg-card shadow-lg">
		<WalletIcon class="size-6 text-primary" />
	</div>
</div>
