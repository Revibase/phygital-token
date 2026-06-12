<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	$effect(() => {
		if (!browser) {
			return;
		}
		const mint = $page.url.searchParams.get('mint')?.trim();
		if (mint) {
			void goto(`/card/${encodeURIComponent(mint)}`, { replaceState: true });
		}
	});
</script>

<section class="landing">
	<h1>Phygital Cards</h1>
	<p>Scan or tap a trading card to view it on-chain.</p>
	<p class="hint">Card URLs look like <code>/card/&lt;instance-address&gt;</code></p>
	<p class="create-link">
		<a href="/create">Create collection, design, or mint card →</a>
	</p>
</section>

<style>
	.landing {
		width: min(100%, 440px);
		padding: 2rem 1.5rem;
		text-align: center;
		border-radius: calc(var(--radius) + 4px);
		background: var(--card);
		border: 1px solid var(--border);
		box-shadow: 0 1px 2px var(--shadow-color);
	}

	h1 {
		margin: 0 0 0.75rem;
		font-size: 1.5rem;
	}

	p {
		margin: 0;
		color: var(--muted-foreground);
		line-height: 1.5;
	}

	.hint {
		margin-top: 1.25rem;
		font-size: 0.9rem;
	}

	.create-link {
		margin-top: 1.5rem;
		font-size: 0.95rem;
	}

	.create-link a {
		color: var(--foreground);
		font-weight: 600;
		text-decoration: none;
	}

	.create-link a:hover {
		text-decoration: underline;
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.85rem;
	}
</style>
