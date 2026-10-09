<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner';
	import { configureRpc } from '$lib/client/rpc';
	import { PersistQueryClientProvider } from '@tanstack/svelte-query-persist-client';
	import { queryClient, persistOptions } from '$lib/client/queries';

	let { data, children } = $props();
	$effect.pre(() => {
		if (data.rpcUrl) configureRpc(data.rpcUrl);
	});
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
