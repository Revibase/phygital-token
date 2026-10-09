<script lang="ts">
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import { explorerUrl } from '$lib/shared/explorer';

	let { value, cluster, kind = 'address', label }: { value: string; cluster: string; kind?: 'address' | 'tx'; label: string } = $props();
</script>

<a
	href={explorerUrl(kind, value, cluster)}
	target="_blank"
	rel="noopener noreferrer"
	aria-label={label}
	onclick={(e) => e.stopPropagation()}
	class="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
>
	<ArrowUpRightIcon class="size-4" />
</a>
