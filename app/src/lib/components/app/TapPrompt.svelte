<script lang="ts">
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import AccessoryMark from './AccessoryMark.svelte';

	let { hint, title = 'Hold your accessory to your phone' }: { hint: string; title?: string } = $props();
</script>

<div class="flex flex-col items-center gap-5 py-4 text-center" role="status" aria-live="polite">
	<div class="relative flex items-center gap-4">
		<div class="grid h-24 w-14 place-items-center rounded-2xl border-2 border-foreground/70 bg-card">
			<SmartphoneIcon class="size-5 text-muted-foreground" />
		</div>
		<AccessoryMark state="waiting" size="sm" />
	</div>
	<div class="space-y-1">
		<p class="text-base font-semibold">{title}</p>
		<p class="text-sm text-muted-foreground">{hint}</p>
	</div>
</div>
