<script lang="ts">
	import { gridAttributes } from '$lib/card';
	import type { CardAttribute } from 'phygital-nfts-client';

	let { attributes }: { attributes: CardAttribute[] } = $props();

	const stats = $derived(gridAttributes(attributes));
</script>

{#if stats.length > 0}
	<section class="stats">
		<h2>Card stats</h2>
		<dl class="grid">
			{#each stats as stat (stat.traitType)}
				<div class="pill">
					<dt>{stat.traitType}</dt>
					<dd>{stat.value}</dd>
				</div>
			{/each}
		</dl>
	</section>
{/if}

<style>
	.stats {
		margin-top: 1.5rem;
		padding: 0 1rem;
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--muted-foreground);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.55rem;
		margin: 0;
	}

	.pill {
		padding: 0.65rem 0.75rem;
		border-radius: var(--radius);
		background: var(--card);
		border: 1px solid var(--border);
	}

	dt {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	dd {
		margin: 0.2rem 0 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--foreground);
	}
</style>
