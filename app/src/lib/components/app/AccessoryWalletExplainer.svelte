<script lang="ts">
	let { bearer = false }: { bearer?: boolean } = $props();
</script>

<div class="space-y-2 px-1 text-[14px] leading-relaxed">
	<p class="font-medium">This wallet is optional.</p>
	<p class="text-muted-foreground">
		You don’t need it to authenticate with your accessory. Use it to keep assets with the accessory;
		the owner can move them at any time.
	</p>
	<p class="text-muted-foreground">
		It belongs to the accessory, not to you: it’s separate from the wallet you own it with, and
		stays with the accessory if it changes hands.
	</p>
	<p class="text-muted-foreground">
		Turn on tap to sign if you want the accessory to approve transactions, within limits the owner
		sets.
	</p>
	{#if bearer}<p class="text-muted-foreground">
			A new owner gains control of the assets. Move them before passing the accessory on.
		</p>{/if}
</div>
