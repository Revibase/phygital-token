<script lang="ts">
	import { Progress } from '$lib/components/ui/progress';
	import { onDestroy } from 'svelte';

	let { until, total = 180_000, onexpire }: { until: number; total?: number; onexpire?: () => void } = $props();
	let now = $state(Date.now());
	const timer = setInterval(() => (now = Date.now()), 500);
	onDestroy(() => clearInterval(timer));

	const remaining = $derived(Math.max(0, until - now));
	const label = $derived(`${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`);
	let fired = false;
	$effect(() => {
		if (remaining === 0 && !fired) {
			fired = true;
			onexpire?.();
		}
	});
</script>

<div class="space-y-1.5">
	<Progress value={Math.min(100, (remaining / total) * 100)} class="h-1" aria-label="Time left to finish" />
	<p class="text-right font-mono text-xs text-muted-foreground tabular-nums">{label} left</p>
</div>
