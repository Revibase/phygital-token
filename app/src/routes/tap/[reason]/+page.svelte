<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import { TAP_FAILURE_COPY } from '$lib/client/link/messages';

	let { data } = $props();
	const copy = $derived(TAP_FAILURE_COPY[data.reason]);
	// Everything except "not registered" is fixed by tapping again.
	const retryable = $derived(data.reason !== 'unknown');
</script>

<svelte:head><title>{copy.title} · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col items-center justify-center gap-8 pb-8" role={data.reason === 'expired' ? undefined : 'alert'}>
		<AccessoryMark state={retryable ? 'waiting' : 'idle'} />
		<PageHeader align="center" title={copy.title} body={copy.body} />
	</section>
	{#snippet footer()}
		<Button href="/" variant="ghost" class="h-11 w-full text-muted-foreground">Use your wallet instead</Button>
	{/snippet}
</PageShell>
