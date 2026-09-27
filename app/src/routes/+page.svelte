<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import LifeBuoyIcon from '@lucide/svelte/icons/life-buoy';
</script>

<PageShell>
	<section class="flex flex-1 flex-col items-center justify-center gap-8 text-center">
		<AccessoryMark state="waiting" />
		<div class="animate-rise space-y-3">
			<h1 class="text-3xl font-semibold">Tap your accessory.<br />Your identity comes with you.</h1>
			<p class="text-muted-foreground">Hold your accessory to the back or top of your phone to begin.</p>
		</div>
	</section>
	{#snippet footer()}
		<div class="grid gap-2">
			<Button href="/link" variant="outline" size="lg" class="h-12 rounded-xl"><MonitorIcon /> Link from a computer</Button>
			<Button href="/wallet" variant="ghost" size="lg" class="h-12 rounded-xl text-muted-foreground">
				<LifeBuoyIcon /> Lost your accessory?
			</Button>
		</div>
	{/snippet}
</PageShell>
