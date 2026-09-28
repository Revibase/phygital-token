<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
</script>

<PageShell>
	<section class="flex flex-1 flex-col items-center justify-center gap-8 pb-8">
		<!-- The page is waiting for exactly one thing: a tap. The ring says so. -->
		<AccessoryMark state="waiting" />
		<PageHeader align="center" title="Hold your accessory to your phone" body="Your Revibase accessory signs you in as your wallet." />
	</section>
	{#snippet footer()}
		<nav class="flex items-center justify-center gap-1 text-[14px]" aria-label="Other options">
			<Button href="/link" variant="ghost" class="h-11 px-3 text-muted-foreground hover:text-foreground">Use a computer</Button>
			<span class="text-border" aria-hidden="true">|</span>
			<Button href="/wallet" variant="ghost" class="h-11 px-3 text-muted-foreground hover:text-foreground">Lost your accessory?</Button>
		</nav>
	{/snippet}
</PageShell>
