<script lang="ts">
	let { bearer = false }: { bearer?: boolean } = $props();
</script>

<div class="space-y-2 px-1 text-[14px] leading-relaxed">
	<p class="font-medium">Assets stay with this accessory.</p>
	<p class="text-muted-foreground">The current owner can move funds directly.</p>
	<p class="text-muted-foreground">Tap the accessory to sign transactions the owner has allowed, within the limits they set.</p>
	{#if bearer}<p class="text-muted-foreground">A new owner gains control of the assets. Move them before passing the accessory on.</p>{/if}
</div>
