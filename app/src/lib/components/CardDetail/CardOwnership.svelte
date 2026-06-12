<script lang="ts">
	import { mintExplorerUrl } from '$lib/explorer';
	import { shortenAddress } from '$lib/format';
	import type { Address } from '@solana/kit';

	let {
		cardInstance,
		designMint,
		currentOwner
	}: {
		cardInstance: Address;
		designMint: Address;
		currentOwner: Address;
	} = $props();

	let open = $state(false);

	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// ignore
		}
	}
</script>

<section class="ownership">
	<button type="button" class="toggle" onclick={() => (open = !open)}>
		<span>Blockchain info</span>
		<span class="chevron" class:open>{open ? '−' : '+'}</span>
	</button>

	{#if open}
		<dl class="details">
			<div>
				<dt>Current holder</dt>
				<dd>
					<span>{shortenAddress(currentOwner, 6)}</span>
					<button type="button" class="copy" onclick={() => copyText(currentOwner)}>
						Copy
					</button>
				</dd>
			</div>
			<div>
				<dt>Card instance</dt>
				<dd>
					<span>{shortenAddress(cardInstance, 6)}</span>
					<button type="button" class="copy" onclick={() => copyText(cardInstance)}>Copy</button>
				</dd>
			</div>
			<div>
				<dt>Design mint</dt>
				<dd>
					<a href={mintExplorerUrl(designMint)} target="_blank" rel="noreferrer">
						{shortenAddress(designMint, 6)}
					</a>
					<button type="button" class="copy" onclick={() => copyText(designMint)}>Copy</button>
				</dd>
			</div>
		</dl>
	{/if}
</section>

<style>
	.ownership {
		margin-top: 1rem;
		padding: 0 1rem;
	}

	.toggle {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--card);
		color: var(--card-foreground);
		font-size: 0.92rem;
		font-weight: 600;
		cursor: pointer;
	}

	.chevron {
		color: var(--muted-foreground);
		font-size: 1.1rem;
		line-height: 1;
	}

	.details {
		margin: 0.5rem 0 0;
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		background: var(--muted);
		border: 1px solid var(--border);
	}

	.details div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border);
	}

	.details div:last-child {
		border-bottom: 0;
	}

	dt {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted-foreground);
	}

	dd {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.82rem;
		color: var(--foreground);
	}

	a {
		color: var(--foreground);
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}

	.copy {
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0;
	}

	.copy:hover {
		color: var(--foreground);
	}
</style>
