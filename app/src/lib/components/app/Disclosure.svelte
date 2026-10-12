<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as Collapsible from '$lib/components/ui/collapsible';

	/** Optional detail behind a muted trigger with a chevron. */
	let {
		label,
		open = $bindable(false),
		disabled = false,
		children
	}: { label: string; open?: boolean; disabled?: boolean; children: Snippet } = $props();
</script>

<Collapsible.Root bind:open>
	<Collapsible.Trigger {disabled} class="group flex min-h-11 w-full items-center justify-between gap-2 text-left text-[13px] text-muted-foreground">
		{label}<ChevronDown class="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
	</Collapsible.Trigger>
	<Collapsible.Content>{@render children()}</Collapsible.Content>
</Collapsible.Root>
