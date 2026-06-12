<script lang="ts">
	import type { RarityTier } from '$lib/card';
	import type { CardAttribute } from 'phygital-nfts-client';
	import { hasHoloEffect } from '$lib/card';

	let {
		image,
		name,
		symbol,
		accentColor,
		rarityTier,
		keyStats = []
	}: {
		image: string | null;
		name: string;
		symbol: string;
		accentColor: string;
		rarityTier: RarityTier;
		keyStats?: CardAttribute[];
	} = $props();

	let loaded = $state(false);
	let fullscreen = $state(false);

	const holo = $derived(hasHoloEffect(rarityTier));

	const hpStat = $derived(keyStats.find((s) => s.traitType.toLowerCase() === 'hp'));
	const typeStat = $derived(keyStats.find((s) => s.traitType.toLowerCase() === 'type'));

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
				<div class="inner-frame" aria-hidden="true"></div>
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
				{#if hpStat}
					<div class="overlay-stat hp">
						<span class="label">{hpStat.traitType}</span>
						<span class="value">{hpStat.value}</span>
					</div>
				{/if}
				{#if typeStat}
					<div class="overlay-stat type">
						<span class="label">{typeStat.traitType}</span>
						<span class="value">{typeStat.value}</span>
					</div>
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

	.inner-frame {
		position: absolute;
		inset: 10px;
		border-radius: 12px;
		border: 1px solid color-mix(in oklch, var(--foreground) 10%, transparent);
		pointer-events: none;
		z-index: 1;
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

	.overlay-stat {
		position: absolute;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.35rem 0.55rem;
		border-radius: 10px;
		background: color-mix(in oklch, var(--background) 72%, transparent);
		border: 1px solid color-mix(in oklch, var(--foreground) 12%, transparent);
		backdrop-filter: blur(6px);
	}

	.overlay-stat.hp {
		top: 0.65rem;
		right: 0.65rem;
		align-items: flex-end;
	}

	.overlay-stat.type {
		bottom: 0.65rem;
		left: 0.65rem;
	}

	.label {
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-foreground);
	}

	.value {
		font-size: 0.95rem;
		font-weight: 800;
		color: var(--foreground);
		line-height: 1;
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
