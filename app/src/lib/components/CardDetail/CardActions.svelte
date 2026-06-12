<script lang="ts">
	let {
		canClaim,
		onClaim
	}: {
		canClaim: boolean;
		onClaim: () => void;
	} = $props();
</script>

<div class="action-bar">
	{#if !canClaim}
		<button type="button" class="unavailable" disabled>Claim unavailable</button>
	{:else}
		<button type="button" class="primary" onclick={onClaim}>Claim card</button>
		<p class="hint">Tap your physical card, then sign with your wallet.</p>
	{/if}
</div>

<style>
	.action-bar {
		position: fixed;
		left: 50%;
		bottom: 0;
		transform: translateX(-50%);
		z-index: 30;
		width: min(100%, 480px);
		padding: 0.85rem 1rem calc(0.85rem + env(safe-area-inset-bottom, 0));
		background: color-mix(in oklch, var(--background) 92%, transparent);
		border-top: 1px solid var(--border);
		backdrop-filter: blur(10px);
	}

	.primary,
	.unavailable {
		width: 100%;
		min-height: 48px;
		border: 0;
		border-radius: calc(var(--radius) + 4px);
		padding: 0.95rem 1rem;
		font-size: 1.05rem;
		font-weight: 600;
		cursor: pointer;
	}

	.primary {
		color: var(--primary-foreground);
		background: var(--primary);
		transition: transform 120ms ease, opacity 120ms ease;
	}

	.primary:hover:not(:disabled) {
		opacity: 0.88;
		transform: translateY(-1px);
	}

	.unavailable {
		color: var(--muted-foreground);
		background: var(--muted);
		border: 1px solid var(--border);
		cursor: not-allowed;
	}

	.hint {
		margin: 0.55rem 0 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: var(--muted-foreground);
		text-align: center;
	}
</style>
