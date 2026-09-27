<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import ErrorCard from '$lib/components/app/ErrorCard.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import { TAP_FAILURE_COPY } from '$lib/client/link/messages';

	let { data } = $props();
	const copy = $derived(TAP_FAILURE_COPY[data.reason]);
	const retryable = $derived(data.reason !== 'unknown');
</script>

<svelte:head><title>{copy.title}</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col justify-center gap-8">
		<div class="flex justify-center"><AccessoryMark state={retryable ? 'waiting' : 'idle'} /></div>
		{#if data.reason === 'expired'}
			<div class="animate-rise space-y-2 text-center">
				<h1 class="text-2xl font-semibold">{copy.title}</h1>
				<p class="text-muted-foreground">{copy.body}</p>
			</div>
		{:else}
			<ErrorCard title={copy.title} body={copy.body} detail={`reason: ${data.reason}`}>
				{#snippet actions()}
					<Button href="/" variant="outline" size="lg" class="h-12 rounded-xl">Back to start</Button>
				{/snippet}
			</ErrorCard>
		{/if}
	</section>
</PageShell>
