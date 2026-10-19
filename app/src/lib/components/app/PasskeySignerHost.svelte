<script lang="ts">
	import { onMount } from 'svelte';
	import { signerIframeAllow } from 'revibase-wallet-sdk';
	import {
		passkeyFrame,
		registerPasskey,
		type PasskeyConfig
	} from '#lib/client/wallet/passkey.svelte.ts';

	let { config, rpcUrl }: { config: PasskeyConfig; rpcUrl: string } = $props();

	let iframe = $state<HTMLIFrameElement | null>(null);

	// Registered once per page load, before any wallet list is shown.
	onMount(() => (iframe ? registerPasskey(iframe, config, rpcUrl) : undefined));
</script>

<!--
	The signer frame asks for the username, confirms creation and shows what a
	transaction does. It stays mounted (and tiny) between prompts, and only the
	frame's own buttons answer them: the page can't cancel a pending request.
-->
{#if passkeyFrame.open}
	<!-- Same overlay as ResponsiveSheet's drawer and dialog. pointer-events-auto: an open dialog underneath sets pointer-events: none on <body>. -->
	<div
		class="pointer-events-auto fixed inset-0 z-[60] animate-in bg-black/10 duration-200 fade-in-0 supports-backdrop-filter:backdrop-blur-xs"
		aria-hidden="true"
	></div>
{/if}
<!--
	Dressed as ResponsiveSheet: a bottom drawer with a handle on phones, a
	centered dialog from md up. The frame pads its own content by 16px, so the
	wrappers add the rest of the sheet's gutter (20px drawer, 24px dialog).
	The sheet caps its own height, as theirs do, and the frame shrinks to fit and
	scrolls inside, so a tall prompt never pushes the rounded corners off-screen.
	isolate: Safari only clips a scrolling iframe to the radius in its own stacking context.
-->
<div
	class={passkeyFrame.open
		? 'pointer-events-auto fixed inset-x-0 bottom-0 z-[61] isolate flex max-h-[80dvh] animate-in flex-col overflow-hidden rounded-t-xl border-t bg-background duration-200 fade-in-0 slide-in-from-bottom md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[min(720px,calc(100dvh-4rem))] md:w-[calc(100%-2rem)] md:max-w-[420px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[20px] md:border-0 md:shadow-[0_24px_64px_-24px_rgb(14_26_26/0.35)] md:ring-1 md:ring-black/5 md:slide-in-from-bottom-0 md:zoom-in-95'
		: 'pointer-events-none fixed right-0 bottom-0 size-px overflow-hidden opacity-0'}
	role={passkeyFrame.open ? 'dialog' : undefined}
	aria-modal={passkeyFrame.open ? 'true' : undefined}
	aria-label="Revibase Passkey"
	aria-hidden={!passkeyFrame.open}
>
	{#if passkeyFrame.open}
		<div class="mx-auto mt-4 h-1.5 w-[100px] shrink-0 rounded-full bg-muted md:hidden"></div>
	{/if}
	<div
		class={passkeyFrame.open
			? 'mx-auto flex min-h-0 w-full max-w-md flex-col px-1 pt-1 pb-[max(0.25rem,calc(env(safe-area-inset-bottom)-1rem))] md:max-w-none md:p-2'
			: ''}
	>
		<!-- allow must be set before the frame loads: changing it later only applies on the next navigation. -->
		<iframe
			bind:this={iframe}
			allow={signerIframeAllow(config.origin)}
			src={`${config.origin}/`}
			title="Revibase Passkey"
			class={passkeyFrame.open ? 'block min-h-0 w-full shrink border-0' : 'block w-full border-0'}
			style:height={passkeyFrame.open ? `${Math.max(passkeyFrame.height, 200)}px` : '1px'}
		></iframe>
	</div>
</div>
