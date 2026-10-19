<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import favicon from '#lib/assets/favicon.svg';
	import { Toaster } from '#lib/components/ui/sonner/index.ts';
	import PasskeySignerHost from '#lib/components/app/PasskeySignerHost.svelte';
	import { configureRpc } from '#lib/client/rpc.ts';
	import { PersistQueryClientProvider } from '@tanstack/svelte-query-persist-client';
	import { queryClient, persistOptions } from '#lib/client/cache.ts';
	import { clearStoredOwners } from '#lib/client/memory.ts';

	let { data, children } = $props();
	$effect.pre(() => {
		if (data.rpcUrl) configureRpc(data.rpcUrl);
	});
	onMount(clearStoredOwners);
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#f7f4ef" />
	<meta name="color-scheme" content="light" />
	<meta name="application-name" content="Revibase" />
	<meta name="apple-mobile-web-app-title" content="Revibase" />
	<title>Revibase</title>
</svelte:head>

<!-- Explicit light theme prevents restoring a saved system/dark preference. -->
<Toaster position="top-center" theme="light" />
<PersistQueryClientProvider client={queryClient} {persistOptions}>
	{@render children()}
</PersistQueryClientProvider>
{#if data.passkeySigner && data.rpcUrl}
	<PasskeySignerHost config={data.passkeySigner} rpcUrl={data.rpcUrl} />
{/if}
