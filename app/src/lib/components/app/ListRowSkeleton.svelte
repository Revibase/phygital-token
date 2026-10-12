<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';

	/** A loading placeholder shaped like a `ListRow`. */
	let { avatar = 'size-9 rounded-full', detail = false }: { avatar?: string; detail?: boolean } = $props();
</script>

<li class="flex min-h-14 items-center gap-3 px-4 py-2.5" aria-hidden="true">
	<Skeleton class={avatar} />
	<div class="flex-1 space-y-1.5">
		<Skeleton class="h-3.5 w-32" />
		{#if detail}<Skeleton class="h-3 w-20" />{/if}
	</div>
</li>
