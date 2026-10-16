<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let { class: className, type = 'text', value = $bindable(''), ...rest }: HTMLInputAttributes = $props();
</script>

<input
	data-slot="input"
	{type}
	bind:value
	class={cn(
		'h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 py-2 text-[14px] shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
		className
	)}
	{...rest}
/>
