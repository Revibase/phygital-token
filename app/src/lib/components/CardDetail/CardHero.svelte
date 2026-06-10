<script lang="ts">
	import type { RarityTier } from '$lib/card';
	import { hasHoloEffect } from '$lib/card';

	let {
		image,
		name,
		symbol,
		accentColor,
		rarityTier
	}: {
		image: string | null;
		name: string;
		symbol: string;
		accentColor: string;
		rarityTier: RarityTier;
	} = $props();

	let loaded = $state(false);
	let fullscreen = $state(false);

	const holo = $derived(hasHoloEffect(rarityTier));

	function handleLoad() {
		loaded = true;
	}

	function toggleFullscreen() {
		if (!image) {
			return;
		}
		fullscreen = !fullscreen;
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') {
			fullscreen = false;
		}
	}}
/>

<div class="hero" style={`--accent: ${accentColor}`}>
	<button
		type="button"
		class="frame"
		class:loaded
		class:holo
		onclick={toggleFullscreen}
		aria-label={image ? `View ${name} artwork` : undefined}
		disabled={!image}
	>
		{#if image}
			<div class="skeleton" class:hidden={loaded} aria-hidden="true"></div>
			<div class="art-wrap">
				<img
					class="artwork"
					class:visible={loaded}
					src={image}
					alt={name}
					onload={handleLoad}
				/>
				{#if holo}
					<div class="holo-overlay" aria-hidden="true"></div>
				{/if}
			</div>
		{:else}
			<div class="placeholder">
				<span>{symbol || '—'}</span>
			</div>
		{/if}
	</button>
</div>

{#if fullscreen && image}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="lightbox" role="presentation" onclick={() => (fullscreen = false)}>
		<img src={image} alt={name} />
	</div>
{/if}

<style>
	.hero {
		width: 100%;
	}

	.frame {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: zoom-in;
		position: relative;
		transform: perspective(900px) rotateX(1.5deg);
		transition: transform 180ms ease;
	}

	.frame:disabled {
		cursor: default;
	}

	.frame:hover:not(:disabled) {
		transform: perspective(900px) rotateX(0deg) scale(1.01);
	}

	.art-wrap,
	.placeholder,
	.skeleton {
		display: block;
		width: 100%;
		aspect-ratio: 2 / 3;
		border-radius: 18px;
		border: 3px solid color-mix(in srgb, var(--accent) 60%, transparent);
		box-shadow:
			0 24px 56px var(--shadow-color),
			inset 0 1px 0 color-mix(in oklch, var(--foreground) 8%, transparent);
		background: var(--card);
		overflow: hidden;
		position: relative;
	}

	.art-wrap {
		border: 3px solid color-mix(in srgb, var(--accent) 60%, transparent);
	}

	.artwork {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity 240ms ease;
	}

	.artwork.visible {
		opacity: 1;
	}

	.holo-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			125deg,
			transparent 30%,
			rgba(255, 255, 255, 0.12) 42%,
			rgba(56, 189, 248, 0.18) 48%,
			rgba(167, 139, 250, 0.15) 52%,
			transparent 64%
		);
		background-size: 220% 220%;
		mix-blend-mode: screen;
		animation: holoShift 4.5s ease-in-out infinite;
	}

	.skeleton {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			110deg,
			var(--muted) 8%,
			var(--secondary) 18%,
			var(--muted) 33%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
		border-radius: 18px;
	}

	.skeleton.hidden {
		opacity: 0;
		pointer-events: none;
	}

	.placeholder {
		display: grid;
		place-items: center;
		color: var(--muted-foreground);
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: 1.5rem;
		background: var(--overlay);
		backdrop-filter: blur(8px);
		cursor: zoom-out;
	}

	.lightbox img {
		max-width: min(100%, 420px);
		max-height: 90vh;
		border-radius: 16px;
		box-shadow: 0 24px 80px var(--shadow-color);
	}

	@media (max-width: 480px) {
		.hero {
			margin-left: -1rem;
			margin-right: -1rem;
			width: calc(100% + 2rem);
		}

		.art-wrap,
		.placeholder,
		.skeleton {
			border-radius: 0;
			border-left: 0;
			border-right: 0;
		}
	}

	@keyframes shimmer {
		to {
			background-position-x: -200%;
		}
	}

	@keyframes holoShift {
		0%,
		100% {
			background-position: 0% 50%;
		}
		50% {
			background-position: 100% 50%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.frame {
			transform: none;
		}

		.skeleton,
		.holo-overlay {
			animation: none;
		}
	}
</style>
