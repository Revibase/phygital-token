<script lang="ts">
	import PageShell from '$lib/components/app/PageShell.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import { Button } from '$lib/components/ui/button';
	import { invalidateAll } from '$app/navigation';
	let { data } = $props();
	let open = $state(true);
</script>

<svelte:head><title>Unlink from wallet · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col justify-center gap-6 pt-4">
	<PageHeader title="Unlink from wallet" body={data.accessory.linkedWallet ? 'Approve with the linked wallet.' : 'No wallet is linked.'} />
	{#if data.accessory.canRelease}
		<Button size="xl" class="w-full" onclick={() => open = true}>Unlink from wallet</Button>
	{:else if data.accessory.linkedWallet}
		<p class="text-sm text-muted-foreground">This wallet link cannot be changed.</p>
	{/if}
	<Button href="/" variant="ghost">Back to Revibase</Button>
	</section>
</PageShell>
{#if data.accessory.canRelease}
	<ReleaseSheet accessory={data.accessory} cluster={data.cluster} bind:open onreleased={() => invalidateAll()} />
{/if}
