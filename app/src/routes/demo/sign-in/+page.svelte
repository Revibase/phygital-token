<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { startAuthentication } from 'phygital-token-sdk';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import ErrorCard from '$lib/components/app/ErrorCard.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import TapPrompt from '$lib/components/app/TapPrompt.svelte';
	import WalletChip from '$lib/components/app/WalletChip.svelte';
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
	let hint = $state('Hold your accessory to your phone.');
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
		hint = tapHint();
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

<svelte:head><title>Sign in with your accessory</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col gap-6 pt-4">
		<div class="space-y-1">
			<p class="text-xs font-medium tracking-wide text-primary uppercase">Demo</p>
			<h1 class="text-2xl font-semibold">Sign in with your accessory</h1>
			<p class="text-muted-foreground">
				What a partner app sees: one tap proves the accessory is here, and it signs you in as the wallet it’s linked to.
			</p>
		</div>

		{#if failure}<ErrorCard title={failure.title} body={failure.body} detail={failure.detail} />{/if}

		{#if result}
			<div class="flex flex-col items-center gap-5 text-center" role="status" aria-live="polite">
				{#if result.wallet}
					<BondVisual tag={result.accessory.tag} />
					<div class="animate-rise space-y-1">
						<h2 class="text-2xl font-semibold">Signed in</h2>
						<p class="text-muted-foreground">No wallet popup, no seed phrase — just the accessory.</p>
					</div>
					<div class="w-full"><WalletChip address={result.wallet} label="Signed in as" /></div>
				{:else}
					<AccessoryMark tag={result.accessory.tag} state="verified" />
					<Card.Root class="w-full rounded-2xl">
						<Card.Content class="space-y-1 text-left text-sm">
							<p class="font-medium">Authentic, but not linked yet</p>
							<p class="text-muted-foreground">Link a wallet to this accessory first, then it can sign you in.</p>
						</Card.Content>
					</Card.Root>
				{/if}
			</div>
		{:else if !webauthnOk}
			<ErrorCard title="Open in Safari or Chrome" body="This browser can’t read your accessory. Open this page in your phone’s main browser." />
		{:else}
			<TapPrompt {hint} title={tapping ? 'Hold still…' : 'Tap to sign in'} />
		{/if}
	</section>

	{#snippet footer()}
		{#if result}
			<Button variant="outline" size="lg" class="h-12 w-full rounded-xl" onclick={again}>Try again</Button>
		{:else if webauthnOk}
			<Button size="lg" class="h-14 w-full rounded-xl text-base" disabled={tapping || !challenge} onclick={signIn}>
				{#if tapping}<Spinner /> Waiting for your accessory…{:else if !challenge}<Spinner /> Preparing…{:else}Sign in with accessory{/if}
			</Button>
		{/if}
	{/snippet}
</PageShell>
