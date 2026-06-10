<script lang="ts">
	let { description }: { description: string | null } = $props();
</script>

{#if description}
	<section class="description">
		<h2>Description</h2>
		<p>{description}</p>
	</section>
{/if}

<style>
	.description {
		margin-top: 1.5rem;
		padding: 0 1rem;
	}

	h2 {
		margin: 0 0 0.5rem;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--muted-foreground);
	}

	p {
		margin: 0;
		line-height: 1.6;
		color: var(--foreground);
		font-size: 0.95rem;
	}
</style>
