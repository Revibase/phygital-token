<script lang="ts">
	import { getKeyStats } from '$lib/card';
	import type { CardAttribute } from 'phygital-nfts-client';

	let { attributes }: { attributes: CardAttribute[] } = $props();

	const keyStats = $derived(getKeyStats(attributes));
</script>

{#if keyStats.length > 0}
	<div class="key-stats">
		{#each keyStats as stat (stat.traitType)}
			<div class="stat">
				<span class="label">{stat.traitType}</span>
				<span class="value">{stat.value}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.key-stats {
		display: flex;
		gap: 0.65rem;
		margin-top: 1rem;
		padding: 0 1rem;
	}

	.stat {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.75rem 0.85rem;
		border-radius: var(--radius);
		background: var(--card);
		border: 1px solid var(--border);
	}

	.label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--muted-foreground);
	}

	.value {
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--foreground);
	}
</style>
