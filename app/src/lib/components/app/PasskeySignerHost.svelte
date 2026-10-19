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
	<!-- pointer-events-auto: an open dialog underneath sets pointer-events: none on <body>. -->
	<div class="pointer-events-auto fixed inset-0 z-[60] bg-black/40" aria-hidden="true"></div>
{/if}
<div
	class={passkeyFrame.open
		? 'pointer-events-auto fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-[480px] overflow-hidden rounded-t-[22px] bg-background shadow-2xl md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-[440px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[22px]'
		: 'pointer-events-none fixed right-0 bottom-0 size-px overflow-hidden opacity-0'}
	role={passkeyFrame.open ? 'dialog' : undefined}
	aria-modal={passkeyFrame.open ? 'true' : undefined}
	aria-label="Revibase Passkey"
	aria-hidden={!passkeyFrame.open}
>
	<!-- allow must be set before the frame loads: changing it later only applies on the next navigation. -->
	<iframe
		bind:this={iframe}
		allow={signerIframeAllow(config.origin)}
		src={`${config.origin}/`}
		title="Revibase Passkey"
		class="block w-full border-0"
		style:height={passkeyFrame.open ? `${Math.max(passkeyFrame.height, 200)}px` : '1px'}
	></iframe>
</div>
