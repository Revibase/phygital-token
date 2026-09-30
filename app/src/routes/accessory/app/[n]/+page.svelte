<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import XIcon from '@lucide/svelte/icons/x';

	let { data } = $props();

	// Leaving is a full page load too, so /accessory doesn't inherit this page's frame-src.
	const iconButton =
		'grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none';
</script>

<svelte:head><title>{data.label} · Revibase</title></svelte:head>

{#if data.frame}
	<!-- Our bar stays outside the frame, so the app can't draw over it: it always says whose app this is and how to leave. -->
	<div class="flex h-dvh flex-col bg-background">
		<header class="flex items-center gap-1 border-b border-border/70 px-2 pt-[max(0.25rem,env(safe-area-inset-top))] pb-1">
			<a href="/accessory" data-sveltekit-reload class={iconButton} aria-label="Close and go back to your accessory"><XIcon class="size-5" /></a>
			<div class="min-w-0 flex-1 text-center">
				<p class="truncate text-[15px] font-semibold">{data.label}</p>
				<p class="truncate text-[12px] text-muted-foreground">{data.host}</p>
			</div>
			<a href={data.openHref} target="_blank" rel="noopener noreferrer" class={iconButton} aria-label={`Open ${data.label} in a new tab`}><ArrowUpRightIcon class="size-5" /></a>
		</header>
		<iframe src={data.frame.src} title={data.label} sandbox={data.frame.sandbox} allow={data.frame.allow} referrerpolicy="no-referrer" class="w-full flex-1 border-0 bg-white"></iframe>
	</div>
{:else}
	<PageShell>
		<section class="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">
			<Notice tone="info" title="This app opens in its own tab" body={`${data.host} doesn’t allow being shown inside Revibase.`}>
				{#snippet actions()}
					<div class="grid gap-1">
						<Button href={data.openHref} target="_blank" rel="noopener noreferrer" size="xl" class="w-full">Open {data.label}</Button>
						<Button href="/accessory" data-sveltekit-reload variant="ghost" class="h-11 text-muted-foreground">Back</Button>
					</div>
				{/snippet}
			</Notice>
		</section>
	</PageShell>
{/if}
