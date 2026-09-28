<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner';

	let { children } = $props();
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

<!--
	Light only. No theme persistence or system tracking (mode-watcher would
	restore a stored "system"/"dark" choice). Dark tokens stay in layout.css
	for a future explicit toggle.
-->
<Toaster position="top-center" theme="light" />
{@render children()}
