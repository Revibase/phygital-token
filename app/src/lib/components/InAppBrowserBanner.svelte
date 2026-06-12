<script lang="ts">
	import { browser } from '$app/environment';

	let copied = $state(false);

	async function copyLink() {
		if (!browser) {
			return;
		}
		try {
			await navigator.clipboard.writeText(window.location.href);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// ignore
		}
	}
</script>

<aside class="banner" role="alert">
	<p class="title">Open in your browser to claim</p>
	<p class="body">
		Wallet apps cannot verify your physical card tap. Copy this link and open it in Safari (iOS) or
		Chrome (Android).
	</p>
	<div class="actions">
		<button type="button" class="primary" onclick={copyLink}>
			{copied ? 'Link copied' : 'Copy link'}
		</button>
	</div>
</aside>

<style>
	.banner {
		width: min(100%, 440px);
		margin-bottom: 1rem;
		padding: 1rem 1.1rem;
		border-radius: calc(var(--radius) + 4px);
		background: color-mix(in oklch, var(--warning) 12%, var(--card));
		border: 1px solid color-mix(in oklch, var(--warning) 35%, transparent);
	}

	.title {
		margin: 0 0 0.35rem;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--foreground);
	}

	.body {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--muted-foreground);
	}

	.actions {
		margin-top: 0.85rem;
	}

	.primary {
		width: 100%;
		min-height: 44px;
		border: 0;
		border-radius: var(--radius);
		padding: 0.65rem 1rem;
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--primary-foreground);
		background: var(--primary);
		cursor: pointer;
	}
</style>
