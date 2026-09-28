<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { startAuthentication } from 'phygital-token-sdk';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import { postJson } from '$lib/client/api';
	import { canTapHere, tapHint } from '$lib/client/capability';
	import { describeError, TAP_FAILURE_COPY, type FriendlyError } from '$lib/client/link/messages';
	import { browserRpc } from '$lib/client/rpc';

	let { data } = $props();
	const copy = $derived(TAP_FAILURE_COPY[data.reason]);
	const retryable = $derived(data.reason !== 'unknown');
	const resumable = $derived(data.reason === 'expired');

	type Challenge = {
		challengeId: string;
		message: string;
		at: number;
	};
	let challenge = $state<Challenge | null>(null);
	let tapping = $state(false);
	let failure = $state<FriendlyError | null>(null);
	let webauthnOk = $state(true);
	let body = $state<string | null>(null);

	// Prefetch: iOS only allows WebAuthn inside the user gesture.
	async function prepare() {
		try {
			const c = await postJson<{ challengeId: string; message: string }>('/api/tap/challenge');
			challenge = { ...c, at: Date.now() };
		} catch (err) {
			failure = describeError(err);
		}
	}
	const refresher = setInterval(() => {
		if (resumable && webauthnOk && !tapping && (!challenge || Date.now() - challenge.at > 90_000)) void prepare();
	}, 15_000);
	onDestroy(() => clearInterval(refresher));

	onMount(() => {
		if (!resumable) return;
		webauthnOk = canTapHere();
		const hint = tapHint();
		body = webauthnOk
			? `For your security, this page closes after a few minutes. Tap Continue, then ${hint.charAt(0).toLowerCase()}${hint.slice(1)}`
			: 'For your security, this page closes after a few minutes. Hold your accessory to your phone again.';
		if (webauthnOk) void prepare();
	});

	async function resume() {
		if (!challenge) return;
		const c = challenge;
		challenge = null;
		tapping = true;
		failure = null;
		try {
			const response = await startAuthentication(c.message, { rpc: browserRpc() });
			const { next } = await postJson<{ next: string }>('/api/tap/resume', { challengeId: c.challengeId, response });
			await goto(next, { replaceState: true, invalidateAll: true });
		} catch (err) {
			failure = describeError(err, 'tap');
			void prepare();
		} finally {
			tapping = false;
		}
	}
</script>

<svelte:head><title>{copy.title} · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col items-center justify-center gap-8 pb-8" role={data.reason === 'expired' ? undefined : 'alert'} aria-live="polite">
		<AccessoryMark state={retryable && (!resumable || tapping) ? 'waiting' : 'idle'} />
		<PageHeader align="center" title={copy.title} body={body ?? copy.body} />
		{#if failure}<div class="w-full"><Notice title={failure.title} body={failure.body} detail={failure.detail} /></div>{/if}
	</section>
	{#snippet footer()}
		<div class="grid gap-1">
			{#if resumable && webauthnOk}
				<Button size="xl" class="w-full" disabled={tapping || !challenge} onclick={resume}>
					{#if tapping}<Spinner /> Hold your accessory to your phone…{:else if !challenge}<Spinner /> Preparing…{:else}Continue{/if}
				</Button>
			{/if}
			<Button href="/" variant="ghost" class="h-11 w-full text-muted-foreground">Use your wallet instead</Button>
		</div>
	{/snippet}
</PageShell>
