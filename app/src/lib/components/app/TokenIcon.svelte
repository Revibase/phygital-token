<script lang="ts">
	let {
		src = null,
		label,
		collectible = false
	}: { src?: string | null; label: string; collectible?: boolean } = $props();
	let failedSrc = $state<string | null>(null);
</script>

{#if src && src !== failedSrc}
	<img
		{src}
		alt=""
		class={collectible
			? 'size-11 rounded-lg bg-muted object-cover'
			: 'size-9 rounded-full bg-muted object-cover'}
		onerror={() => (failedSrc = src)}
	/>
{:else}
	<span
		aria-hidden="true"
		class={`grid place-items-center bg-muted text-[12px] font-semibold text-muted-foreground ${collectible ? 'size-11 rounded-lg' : 'size-9 rounded-full'}`}
		>{label.slice(0, 2).toUpperCase()}</span
	>
{/if}
