<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#16171c" />
	<title>Phygital — your accessory</title>
</svelte:head>

<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
{@render children()}
