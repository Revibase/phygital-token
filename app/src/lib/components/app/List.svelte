<script lang="ts">
	import type { Snippet } from 'svelte';
	import Section from './Section.svelte';

	let {
		children,
		label,
		footer,
		class: className = ''
	}: { children: Snippet; label?: string; footer?: string; class?: string } = $props();
</script>

<Section {label} {footer} class={className}>
	<ul
		class="divide-y divide-border/80 overflow-hidden rounded-[14px] bg-card shadow-[0_0_0_1px_rgb(14_26_26/0.05),0_1px_2px_rgb(14_26_26/0.04)]"
	>
		{@render children()}
	</ul>
</Section>
