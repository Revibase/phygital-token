<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { startAuthentication } from 'phygital-token-sdk';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { postJson } from '$lib/client/api';
	import { canTapHere, tapHint } from '$lib/client/capability';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { browserRpc } from '$lib/client/rpc';
	import type { AccessoryView } from '$lib/shared/types';

	type Challenge = { challengeId: string; message: string; at: number };

	let challenge = $state<Challenge | null>(null);
	let tapping = $state(false);
	let failure = $state<FriendlyError | null>(null);
	let result = $state<{ accessory: AccessoryView; wallet: string | null } | null>(null);
	let hint = $state('Tap Sign in, then hold your accessory to your phone.');
	let webauthnOk = $state(true);

	// Fetched ahead of the click: iOS only allows WebAuthn inside the user gesture.
	async function prepare() {
		try {
			const c = await postJson<{ challengeId: string; message: string }>('/api/signin/challenge');
			challenge = { ...c, at: Date.now() };
		} catch (err) {
			failure = describeError(err);
		}
	}
	const refresher = setInterval(() => {
		if (!tapping && !result && (!challenge || Date.now() - challenge.at > 90_000)) void prepare();
	}, 15_000);
	onDestroy(() => clearInterval(refresher));

	onMount(() => {
		hint = `Tap Sign in, then ${tapHint().charAt(0).toLowerCase()}${tapHint().slice(1)}`;
		webauthnOk = canTapHere();
		void prepare();
	});

	async function signIn() {
		if (!challenge) return;
		const c = challenge;
		challenge = null;
		tapping = true;
		failure = null;
		try {
			// SDK: browser WebAuthn with the accessory's FIDO key; recovers the passkey id if the platform masks it.
			const response = await startAuthentication(c.message, browserRpc());
			result = await postJson('/api/signin/verify', { challengeId: c.challengeId, response });
		} catch (err) {
			failure = describeError(err, 'tap');
			void prepare();
		} finally {
			tapping = false;
		}
	}

	function again() {
		result = null;
		void prepare();
	}
</script>

<svelte:head><title>Sign in with your accessory · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col pt-4" aria-live="polite">
		{#key result ? 'result' : 'tap'}
			<div class="animate-rise flex flex-1 flex-col gap-7">
				{#if result?.wallet}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<BondVisual wallet={result.wallet} />
						<PageHeader align="center" eyebrow={`Accessory · ${result.accessory.tag}`} eyebrowTone="success" title="Signed in" body="One tap. No wallet pop-up." />
						<List><WalletRow address={result.wallet} label="Signed in as" /></List>
					</div>
				{:else if result}
					<div class="flex flex-1 flex-col items-center justify-center gap-8">
						<AccessoryMark state="verified" />
						<PageHeader align="center" eyebrow={`Accessory · ${result.accessory.tag}`} eyebrowTone="success" title="Not linked yet" body="This accessory is genuine, but no wallet is linked to it. Link one first, then sign in." />
					</div>
				{:else}
					<PageHeader eyebrow="Demo" title="Sign in with your accessory" body={hint} />
					{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}
					<div class="grid flex-1 place-items-center py-6"><AccessoryMark state={tapping ? 'waiting' : 'idle'} /></div>
					{#if !webauthnOk}<Notice title="Open this page in Safari or Chrome" body="This browser can’t read your accessory." />{/if}
				{/if}
			</div>
		{/key}
	</section>

	{#snippet footer()}
		{#if result}
			<Button variant="secondary" size="xl" class="w-full" onclick={again}>Sign in again</Button>
		{:else if webauthnOk}
			<Button size="xl" class="w-full" disabled={tapping || !challenge} onclick={signIn}>
				{#if tapping}<Spinner /> Hold your accessory to your phone…{:else if !challenge}<Spinner /> Preparing…{:else}Sign in{/if}
			</Button>
		{/if}
	{/snippet}
</PageShell>
