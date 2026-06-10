<script lang="ts">
	let { onClaim }: { onClaim: () => void } = $props();
</script>

<section class="actions">
	<button type="button" class="primary" onclick={onClaim}>Claim card</button>
	<p class="hint">Tap your physical card, then confirm in your wallet.</p>
</section>

<style>
	.actions {
		margin-top: 1.5rem;
		padding: 0 1rem;
	}

	.primary {
		width: 100%;
		min-height: 48px;
		border: 0;
		border-radius: calc(var(--radius) + 4px);
		padding: 0.95rem 1rem;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--primary-foreground);
		background: var(--primary);
		cursor: pointer;
		transition: transform 120ms ease, opacity 120ms ease;
	}

	.primary:hover {
		opacity: 0.88;
		transform: translateY(-1px);
	}

	.hint {
		margin: 0.75rem 0 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--muted-foreground);
		text-align: center;
	}
</style>
