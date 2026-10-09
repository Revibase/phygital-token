<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import Countdown from '$lib/components/app/Countdown.svelte';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { explorerUrl } from '$lib/shared/explorer';
	import { rememberAccessoryLink, rememberAccessoryWalletApp, rememberRecentWallet, rememberWallet } from '$lib/client/memory';
	import { platform, isLikelyWalletBrowser } from '$lib/client/capability';
	import { linkCopy } from '$lib/client/accessory/link-copy';
	import { claimHandoff, finishInWallet, linkStatus, pollLink, type FinishPhase } from '$lib/client/link/flow';
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

	$effect(() => {
		if (status?.state !== 'linked' || !status.recipient || !status.accessory?.pda) return;
		const method = isLikelyWalletBrowser() ? 'wallet' : 'browser';
		const app = status.walletApp ?? walletStore.walletName;
		rememberWallet(status.accessory.pda, status.recipient);
		rememberRecentWallet(app, method);
		rememberAccessoryWalletApp(status.accessory.pda, status.recipient, app, method);
		rememberAccessoryLink(status.accessory.pda, {
			wallet: status.recipient, app,
			source: method === 'wallet' ? 'wallet' : platform() === 'desktop' ? 'desktop' : 'mobile'
		});
	});

	const s = $derived(status?.state);
	const ready = $derived(s === 'claimed' || s === 'finishing');
	const waitingForTap = $derived(s === 'created' || s === 'awaiting_passkey');
	const ended = $derived(s === 'cancelled' || s === 'expired' || s === 'failed');
	const tag = $derived(status?.accessory?.tag);
	const copy = $derived(linkCopy(status?.accessory?.kind));

	/**
	 * The single-use link is only claimed where a wallet is available. If none
	 * is detected here (e.g. it was opened in Safari), it stays unclaimed and
	 * the picker offers to reopen it inside Phantom / Backpack / Solflare.
	 */
	let pendingH = $state<string | null>(null);
	let claiming = false;
	const browseTarget = $derived(pendingH ? `${window.location.origin}/continue#h=${pendingH}` : null);

	onMount(async () => {
		// Scrub the capability from the URL; retain it only in this tab until claimed.
		// After claiming, reloads use the intent ID plus the HttpOnly finisher cookie.
		let h = new URLSearchParams(window.location.hash.slice(1)).get('h');
		try {
			if (h) {
				sessionStorage.setItem('revibase:pending-handoff', h);
				sessionStorage.removeItem('revibase:finisher-link');
			} else h = sessionStorage.getItem('revibase:pending-handoff');
		} catch {}
		// The router becomes available after the initial hydration task.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		replaceState('/continue', page.state);
		walletStore.init(data.cluster);
		if (!h) {
			let linkId: string | null = null;
			try { linkId = sessionStorage.getItem('revibase:finisher-link'); } catch {}
			if (linkId) {
				try { status = await linkStatus(linkId); startPolling(); }
				catch (err) { failure = describeError(err); }
				return;
			}
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
			try {
				sessionStorage.setItem('revibase:finisher-link', status.id);
				sessionStorage.removeItem('revibase:pending-handoff');
			} catch {}
		} catch (err) {
			pendingH = null;
			failure = describeError(err);
			return;
		}
		startPolling();
	}

	function startPolling() {
		if (!status) return;
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
	<title>Finish linking · Revibase</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col pt-4" aria-live="polite">
		{#key `${s ?? (pendingH ? 'unclaimed' : 'loading')}:${!!walletStore.address}`}
			<div class="animate-rise flex flex-1 flex-col gap-7">
				{#if s === 'linked'}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<BondVisual wallet={status?.recipient ?? walletStore.address} icon={walletStore.walletIcon} pda={status?.accessory?.pda} />
						<PageHeader align="center" title={copy.done.title} body={`${copy.done.body(true, '')} You can close this page.`} />
						{#if status?.txSignature}
							<Button variant="ghost" class="h-11 text-muted-foreground" href={explorerUrl('tx', status.txSignature, data.cluster)} target="_blank" rel="noopener noreferrer">View transaction</Button>
						{/if}
					</div>
				{:else if failure && !status}
					<div class="flex flex-1 flex-col justify-center"><Notice title={failure.title} body={failure.body} detail={failure.detail} /></div>
				{:else if ended}
					<div class="flex flex-1 flex-col justify-center">
						<Notice
							title={s === 'cancelled' ? copy.cancelled : linkErrorCopy(status?.errorCode).title}
							body={s === 'cancelled' ? 'It was cancelled or replaced by a newer tap. Nothing was changed.' : linkErrorCopy(status?.errorCode).body}
						/>
					</div>
				{:else if !status && pendingH}
					<PageHeader title="Open in your wallet" body="Open this link inside your wallet app to finish linking." />
					<WalletPicker
						options={[]}
						onpick={() => {}}
						{browseTarget}
						emptyHint="Copy this page’s link, then open it in your wallet app’s browser."
					/>
				{:else if waitingForTap}
					<PageHeader eyebrow={tag ? `Accessory · ${tag}` : undefined} title="Tap again on your phone" body="The approval expired. Tap your accessory again — this page will continue on its own." />
					<div class="flex items-center gap-3 rounded-[14px] bg-muted px-4 py-3.5 text-[15px]">
						<Spinner class="size-4 text-muted-foreground" /> Waiting for a new tap…
					</div>
				{:else if status && ready}
					<PageHeader
						eyebrow={tag ? `Accessory · ${tag}` : undefined}
						title={walletStore.address ? copy.confirm.title : copy.choose.title}
						body={walletStore.address ? copy.confirm.body : copy.choose.body}
					/>
					{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}
					{#if !walletStore.address}
						<WalletPicker options={walletStore.options} {connecting} onpick={pick} />
					{:else}
						<List><WalletRow address={walletStore.address} label={walletStore.walletName ?? 'This wallet'} icon={walletStore.walletIcon} cluster={data.cluster} /></List>
					{/if}
					{#if status.tapExpiresAt}<Countdown until={status.tapExpiresAt} />{/if}
				{:else if s === 'submitted'}
					<PageHeader title="Almost done" />
					<div class="flex items-center gap-3 rounded-[14px] bg-muted px-4 py-3.5 text-[15px]">
						<Spinner class="size-4 text-muted-foreground" /> Confirming on the network…
					</div>
				{:else}
					<div class="grid flex-1 place-items-center"><Spinner class="size-5 text-muted-foreground" /></div>
				{/if}
			</div>
		{/key}
	</section>

	{#snippet footer()}
		{#if ready && walletStore.address}
			<div class="grid gap-1">
				<Button size="xl" class="w-full" disabled={!!phase} onclick={approve}>
					{#if phase === 'approve'}<Spinner /> Approve in {walletStore.walletName ?? 'your wallet'}…
					{:else if phase === 'confirming'}<Spinner /> Confirming…
					{:else if phase}<Spinner /> Preparing…
					{:else}{copy.action}{/if}
				</Button>
				<Button variant="ghost" class="h-11 text-muted-foreground" disabled={!!phase} onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
			</div>
		{/if}
	{/snippet}
</PageShell>
