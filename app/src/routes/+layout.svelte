<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner';
	import { configureRpc } from '$lib/client/rpc';
	import { PersistQueryClientProvider } from '@tanstack/svelte-query-persist-client';
	import { queryClient, persistOptions } from '$lib/client/cache';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import OpenOnPhone from '$lib/components/app/OpenOnPhone.svelte';
	import { phoneUrl } from '$lib/shared/device';
	import SecureSignerHost from '$lib/components/app/SecureSignerHost.svelte';
	import { configureSecureSigner } from '$lib/client/wallet/secure-signer';

	let { data, children } = $props();
	$effect.pre(() => {
		if (data.rpcUrl) configureRpc(data.rpcUrl);
		if (data.signerOrigin) configureSecureSigner(data.signerOrigin);
	});

	// Mobile only. A Mac user agent may be an iPad, which only touch support reveals.
	let currentHref = $state<string | null>(null);
	onMount(() => {
		const update = () => (currentHref = location.href);
		update();
		window.addEventListener('hashchange', update);
		return () => window.removeEventListener('hashchange', update);
	});
	let touch = $state<boolean | null>(null);
	onMount(() => (touch = navigator.maxTouchPoints > 1));
	const gate = $derived(
		data.device === 'mobile'
			? 'open'
			: data.device === 'mac' && touch === null
				? 'unknown'
				: data.device === 'mac' && touch
					? 'open'
					: 'phone'
	);
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
	{#if gate === 'open'}
		{@render children()}
		<SecureSignerHost />
	{:else if gate === 'phone'}
		<OpenOnPhone
			href={page.url.pathname === '/permissions' && currentHref ? currentHref : phoneUrl(page.url)}
		/>
	{/if}
</PersistQueryClientProvider>
