<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import Countdown from '$lib/components/app/Countdown.svelte';
	import ErrorCard from '$lib/components/app/ErrorCard.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import WalletChip from '$lib/components/app/WalletChip.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import { claimHandoff, finishInWallet, pollLink, type FinishPhase } from '$lib/client/link/flow';
	import { describeError, linkErrorCopy, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { LinkStatusView } from '$lib/shared/types';

	let { data } = $props();

	let status = $state<LinkStatusView | null>(null);
	let failure = $state<FriendlyError | null>(null);
	let connecting = $state<string | null>(null);
	let phase = $state<FinishPhase | null>(null);
	const poller = new AbortController();
	onDestroy(() => poller.abort());

	const s = $derived(status?.state);
	const ready = $derived(s === 'claimed' || s === 'finishing');
	const waitingForTap = $derived(s === 'created' || s === 'awaiting_passkey');

	/**
	 * The single-use link is only claimed where a wallet is available. If none
	 * is detected here (e.g. it was opened in Safari), it stays unclaimed and
	 * the picker offers to reopen it inside Phantom / Backpack / Solflare.
	 */
	let pendingH = $state<string | null>(null);
	let claiming = false;
	const browseTarget = $derived(pendingH ? `${window.location.origin}/continue#h=${pendingH}` : null);

	onMount(async () => {
		// The capability lives only in the fragment. Read it once, then scrub it
		// from the address bar and history before doing anything else.
		const h = new URLSearchParams(window.location.hash.slice(1)).get('h');
		history.replaceState(null, '', '/continue');
		walletStore.init(data.cluster);
		if (!h) {
			failure = { title: 'This link is incomplete', body: 'Go back to your phone’s browser and open the wallet link again.', recovery: 'start_over', code: 'bad_request' };
			return;
		}
		// Injected wallets register right after load; give detection a moment.
		for (let i = 0; i < 10 && walletStore.options.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
		pendingH = h;
	});

	// Claim as soon as a wallet is available here (including late MWA registration).
	$effect(() => {
		if (pendingH && walletStore.options.length > 0 && !claiming) void claim(pendingH);
	});

	async function claim(h: string) {
		claiming = true;
		try {
			status = await claimHandoff(h);
			pendingH = null;
		} catch (err) {
			pendingH = null;
			failure = describeError(err);
			return;
		}
		void pollLink(
			status.id,
			(next) => {
				if (!phase) status = next;
				return next.state === 'linked' || next.state === 'cancelled' || next.state === 'expired' || next.state === 'failed';
			},
			poller.signal
		);
	}

	async function pick(id: string) {
		connecting = id;
		failure = null;
		try {
			await walletStore.connect(id);
		} catch (err) {
			failure = describeError(err);
		} finally {
			connecting = null;
		}
	}

	async function approve() {
		if (!status) return;
		failure = null;
		try {
			status = await finishInWallet(status.id, walletStore.signingContext(), (p) => (phase = p));
		} catch (err) {
			failure = describeError(err);
		} finally {
			phase = null;
		}
	}
</script>

<svelte:head>
	<title>Finish linking</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col gap-6 pt-4">
		{#if s === 'linked'}
			<div class="flex flex-1 flex-col items-center justify-center gap-6 text-center" role="status">
				<BondVisual tag={status?.accessory?.tag ?? ''} />
				<div class="animate-rise space-y-2">
					<h1 class="text-3xl font-semibold">Linked</h1>
					<p class="text-muted-foreground">You can go back to your browser. Your accessory now carries this wallet.</p>
				</div>
			</div>
		{:else}
			<div class="flex items-center gap-4">
				<AccessoryMark tag={status?.accessory?.tag ?? ''} size="sm" state={status ? 'verified' : 'waiting'} />
				<div>
					<h1 class="text-xl font-semibold">Link this wallet</h1>
					{#if status?.accessory}<p class="text-sm text-muted-foreground">to accessory ••{status.accessory.tag}</p>{/if}
				</div>
			</div>

			{#if failure}<ErrorCard title={failure.title} body={failure.body} detail={failure.detail} />{/if}

			{#if s === 'cancelled' || s === 'expired' || s === 'failed'}
				<ErrorCard
					title={s === 'cancelled' ? 'Linking was cancelled' : linkErrorCopy(status?.errorCode).title}
					body={s === 'cancelled' ? 'It was cancelled or replaced by a newer tap. Nothing was changed.' : linkErrorCopy(status?.errorCode).body}
				/>
			{:else if waitingForTap}
				<div class="flex flex-col items-center gap-3 rounded-2xl border p-6 text-center" role="status" aria-live="polite">
					<Spinner class="size-5" />
					<p class="font-medium">Waiting for a new tap</p>
					<p class="text-sm text-muted-foreground">Go back to your browser and tap your accessory again. This page will continue by itself.</p>
				</div>
			{:else if status && ready}
				{#if !walletStore.address}
					<p class="text-sm text-muted-foreground">Choose the wallet this accessory should represent.</p>
					<WalletPicker options={walletStore.options} {connecting} onpick={pick} />
				{:else}
					<WalletChip address={walletStore.address} label={walletStore.walletName ?? 'This wallet'} icon={walletStore.walletIcon} />
					<p class="text-sm text-muted-foreground">
						Anyone holding the accessory will be able to prove they are this wallet. Only continue if the accessory is yours.
					</p>
				{/if}
				{#if status.tapExpiresAt}<Countdown until={status.tapExpiresAt} total={status.tapWindowMs ?? undefined} />{/if}
			{:else if !status && pendingH}
				<p class="text-sm text-muted-foreground">Open this link inside your wallet app to finish linking.</p>
				<WalletPicker
					options={[]}
					onpick={() => {}}
					{browseTarget}
					emptyHint="Open this link inside your wallet app’s browser (copy it from your phone’s browser, then paste it into the wallet’s browser)."
				/>
			{:else if s === 'submitted'}
				<div class="flex flex-col items-center gap-3 rounded-2xl border p-6 text-center" role="status">
					<Spinner class="size-5" /><p class="font-medium">Confirming on the network…</p>
				</div>
			{:else if !failure}
				<div class="grid flex-1 place-items-center"><Spinner class="size-6" /></div>
			{/if}
		{/if}
	</section>

	{#snippet footer()}
		{#if ready && walletStore.address}
			<div class="grid gap-2">
				<Button size="lg" class="h-14 rounded-xl text-base" disabled={!!phase} onclick={approve}>
					{#if phase === 'approve'}<Spinner /> Approve in your wallet…{:else if phase}<Spinner /> Preparing…{:else}Link this wallet{/if}
				</Button>
				<Button variant="ghost" class="h-11 text-muted-foreground" disabled={!!phase} onclick={() => walletStore.disconnect()}>
					Use a different wallet
				</Button>
			</div>
		{/if}
	{/snippet}
</PageShell>
