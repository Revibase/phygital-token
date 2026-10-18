<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '#lib/utils.ts';

	/** The app's one muted surface: grouped controls, notes, copy fields and empty states. */
	let {
		children,
		tone = 'muted',
		element = 'div',
		class: className = ''
	}: {
		children: Snippet;
		tone?: 'muted' | 'tint';
		element?: 'div' | 'li' | 'label' | 'blockquote';
		class?: string;
	} = $props();
</script>

<svelte:element
	this={element}
	class={cn('rounded-[14px] px-4 py-3', tone === 'tint' ? 'bg-primary/5' : 'bg-muted', className)}
>
	{@render children()}
</svelte:element>
