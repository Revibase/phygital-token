<script lang="ts">
	import { onDestroy } from 'svelte';
	import { cn } from '$lib/utils';

	let { until, onexpire, class: className = '' }: { until: number; total?: number; onexpire?: () => void; class?: string } = $props();
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

<p class={cn('text-[13px] tabular-nums transition-colors duration-300', remaining < 30_000 ? 'text-destructive' : 'text-muted-foreground', className)}>
	{remaining > 0 ? `Expires in ${label}` : 'Expired'}
</p>
