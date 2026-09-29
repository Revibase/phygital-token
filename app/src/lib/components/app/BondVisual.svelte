<script lang="ts">
	import AccessoryMark from './AccessoryMark.svelte';
	import WalletAvatar from './WalletAvatar.svelte';

	/** Success moment: accessory ↔ wallet. The connecting line draws once (420ms) to confirm the link. */
	let {
		wallet = null,
		icon = null,
		pda = null,
		hasMint
	}: { wallet?: string | null; icon?: string | null; pda?: string | null; hasMint?: boolean } = $props();
</script>

<div class="flex items-center justify-center gap-3" aria-hidden="true">
	<AccessoryMark size="md" {pda} {hasMint} />
	<div class="relative h-[3px] w-14 overflow-hidden rounded-full bg-border">
		<span class="animate-bond absolute inset-0 rounded-full bg-primary"></span>
	</div>
	<div class="grid size-20 place-items-center rounded-[26%] bg-card shadow-[0_0_0_1px_rgb(14_26_26/0.06),0_8px_24px_-14px_rgb(14_26_26/0.3)]">
		{#if wallet}<WalletAvatar address={wallet} {icon} />{/if}
	</div>
</div>
