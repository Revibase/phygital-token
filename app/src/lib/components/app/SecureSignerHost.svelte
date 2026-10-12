<script lang="ts">
	import { onMount } from 'svelte';
	import { resolveWebAuthnRpId } from 'secure-signer/shared';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import Notice from './Notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { secureSigner } from '$lib/client/wallet/secure-signer';
	import { createPasskey, isCancel, type CreatedPasskey } from '$lib/client/wallet/secure-signer/connect';
	import { passkeyPrompts } from '$lib/client/wallet/secure-signer/prompts.svelte';

	const client = secureSigner();
	let iframe = $state<HTMLIFrameElement | null>(null);
	let open = $state(false);
	let height = $state(328);
	let creating = $state(false);
	let createError = $state<string | null>(null);

	onMount(() => (iframe && client ? client.attach(iframe, { setOpen: (v) => (open = v), setHeight: (h) => (height = h) }) : undefined));

	/** Must start inside the click: Safari needs the user gesture for passkey creation. */
	function create(done: (passkey: CreatedPasskey) => void) {
		createError = null;
		creating = true;
		createPasskey(resolveWebAuthnRpId(location.hostname))
			.then(done)
			.catch((err) => {
				if (!isCancel(err)) createError = 'This browser couldn’t create a passkey. Try Safari or Chrome.';
			})
			.finally(() => (creating = false));
	}
</script>

{#if client}
	{#if open}
		<button type="button" aria-label="Cancel" class="fixed inset-0 z-[60] bg-black/40" onclick={() => client.cancel()}></button>
	{/if}
	<div
		class={open
			? 'fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-[480px] overflow-hidden rounded-t-[22px] bg-background shadow-2xl md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-[440px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[22px]'
			: 'pointer-events-none fixed right-0 bottom-0 size-px overflow-hidden opacity-0'}
		aria-hidden={!open}
	>
		<iframe
			bind:this={iframe}
			src={client.frameSrc}
			title="Revibase Passkey"
			allow="publickey-credentials-get *; clipboard-write *"
			class="block w-full border-0"
			style:height={open ? `${Math.max(height, 200)}px` : '1px'}
		></iframe>
	</div>

	<ResponsiveSheet
		bind:open={() => !!passkeyPrompts.setup, (v) => { if (!v) passkeyPrompts.setup?.({ mode: 'cancel' }); }}
		title="Set up your passkey wallet"
		description="A Solana wallet protected by Face ID or your fingerprint. Nothing to install."
	>
		{#if createError}<Notice title="Couldn’t create a passkey" body={createError} />{/if}
		<Button size="xl" disabled={creating} onclick={() => create((passkey) => passkeyPrompts.setup?.({ mode: 'create', passkey }))}>
			Create a new passkey wallet
		</Button>
		<Button variant="secondary" size="xl" disabled={creating} onclick={() => passkeyPrompts.setup?.({ mode: 'existing' })}>
			I already have one
		</Button>
	</ResponsiveSheet>

	<ResponsiveSheet
		bind:open={() => !!passkeyPrompts.lost, (v) => { if (!v) passkeyPrompts.lost?.resolve({ mode: 'cancel' }); }}
		title="Can’t find your passkey wallet"
		description={passkeyPrompts.lost?.reason === 'not_found'
			? 'That passkey isn’t a Revibase passkey wallet. Pick another one, or create a new wallet.'
			: 'No passkey wallet was picked. If you made it on another phone, make sure your passkeys sync to this one.'}
	>
		{#if createError}<Notice title="Couldn’t create a passkey" body={createError} />{/if}
		<Button size="xl" disabled={creating} onclick={() => passkeyPrompts.lost?.resolve({ mode: 'retry' })}>Try again</Button>
		<Button variant="secondary" size="xl" disabled={creating} onclick={() => create((passkey) => passkeyPrompts.lost?.resolve({ mode: 'create', passkey }))}>
			Create a new wallet
		</Button>
		<p class="text-[13px] leading-snug text-muted-foreground">A new wallet has a new address. Accessories linked to your old wallet stay with it.</p>
	</ResponsiveSheet>
{/if}
