<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import Countdown from '$lib/components/app/Countdown.svelte';
	import HandoffPanel from '$lib/components/app/HandoffPanel.svelte';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import PairingCode from '$lib/components/app/PairingCode.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { canTapHere, tapHint } from '$lib/client/capability';
	import {
		cancelLink,
		claimHandoff,
		finishInWallet,
		linkStatus,
		pollLink,
		prepareTap,
		startPhoneLink,
		tapWithChallenge,
		type FinishPhase
	} from '$lib/client/link/flow';
	import { describeError, linkErrorCopy, type FriendlyError } from '$lib/client/link/messages';
	import { linkCopy } from '$lib/client/accessory/link-copy';
	import { rememberWallet } from '$lib/client/memory';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { shortAddress } from '$lib/shared/encoding';
	import type { LinkStatusView, TransferChallenge } from '$lib/shared/types';

	let { data } = $props();
	const a = $derived(data.accessory);
	const copy = $derived(linkCopy(a.kind));

	let status = $state<LinkStatusView | null>(null);
	let challenge = $state<TransferChallenge | null>(null);
	let challengeAt = 0;
	let handoffUrl = $state<string | null>(null);
	let tapping = $state(false);
	let failure = $state<FriendlyError | null>(null);
	let showComputer = $state(false);
	let localFinish = $state(false);
	let connecting = $state<string | null>(null);
	let phase = $state<FinishPhase | null>(null);
	let hint = $state('Tap Approve, then hold your accessory to your phone.');
	let webauthnOk = $state(true);

	const poller = new AbortController();
	onDestroy(() => poller.abort());

	const s = $derived(status?.state);
	const isDesktop = $derived(status?.kind === 'desktop');
	const needsTap = $derived(s === 'created' || s === 'awaiting_passkey' || s === 'accessory_confirmed' || (s === 'tapped' && !handoffUrl && !isDesktop));
	const done = $derived(s === 'linked');
	const dead = $derived(s === 'cancelled' || s === 'expired' || s === 'failed');

	type View = 'loading' | 'dead' | 'confirm_computer' | 'tap' | 'choose' | 'local' | 'remote' | 'desktop_remote' | 'done';
	const view = $derived.by((): View => {
		if (!status) return failure ? 'dead' : 'loading';
		if (done) return 'done';
		if (dead) return 'dead';
		if (s === 'accessory_attached') return 'confirm_computer';
		if (needsTap) return 'tap';
		if (isDesktop) return 'desktop_remote';
		if (s === 'tapped' && handoffUrl && !localFinish) return 'choose';
		if (localFinish && (s === 'claimed' || s === 'finishing')) return 'local';
		return 'remote';
	});

	/** Only claim "your wallet" when the wallet connected here is the one that was linked. */
	const ownedResult = $derived(!!status?.recipient && walletStore.address === status.recipient);

	function apply(next: LinkStatusView) {
		status = next;
		if (next.state === 'linked' && next.recipient) rememberWallet(a.pda, next.recipient);
		if ((next.state === 'created' || next.state === 'accessory_confirmed') && next.errorCode === 'too_slow' && !failure) {
			failure = linkErrorCopy('too_slow');
			handoffUrl = null;
		}
	}

	// Fetched when a tap is due, then re-fetched once as it goes stale (not polled).
	const STALE_MS = 45_000;
	let staleTimer: ReturnType<typeof setTimeout> | undefined;
	function setChallenge(next: TransferChallenge) {
		challenge = next;
		challengeAt = Date.now();
		clearTimeout(staleTimer);
		staleTimer = setTimeout(() => void refreshChallenge(), STALE_MS);
	}
	let preparing = false;
	let prepareFailures = 0;
	async function refreshChallenge() {
		if (!status || !needsTap || tapping || preparing) return;
		preparing = true;
		try {
			setChallenge(await prepareTap(status.id));
			prepareFailures = 0;
		} catch (err) {
			// Background refresh: only surface it if it keeps failing.
			if (++prepareFailures >= 2) failure = describeError(err);
		} finally {
			preparing = false;
		}
	}

	onMount(async () => {
		hint = `Tap Approve, then ${tapHint().charAt(0).toLowerCase()}${tapHint().slice(1)}`;
		webauthnOk = canTapHere();
		walletStore.init(data.cluster);
		try {
			if (data.pairedLinkId) apply(await linkStatus(data.pairedLinkId));
			else {
				const { challenge: first, ...started } = await startPhoneLink();
				apply(started);
				setChallenge(first);
			}
		} catch (err) {
			failure = describeError(err);
			return;
		}
		void pollLink(
			status!.id,
			(next) => {
				// Local actions own the state while they run.
				if (!tapping && !phase) apply(next);
				return next.state === 'linked' || next.state === 'cancelled' || next.state === 'expired' || next.state === 'failed';
			},
			poller.signal
		);
	});

	// Keep a fresh challenge ready so the tap button can call WebAuthn synchronously (iOS).
	$effect(() => {
		if (needsTap && !tapping && (!challenge || Date.now() - challengeAt > STALE_MS)) void refreshChallenge();
	});
	onDestroy(() => clearTimeout(staleTimer));

	async function tap() {
		if (!challenge || !status) return;
		tapping = true;
		failure = null;
		const fields = challenge;
		challenge = null;
		try {
			const result = await tapWithChallenge(fields, { finishHere: false });
			handoffUrl = result.handoffUrl;
			apply(result.status);
		} catch (err) {
			failure = describeError(err, 'tap');
			void refreshChallenge();
		} finally {
			tapping = false;
		}
	}

	async function useLocalWallet(id: string) {
		if (!status || !handoffUrl) return;
		connecting = id;
		failure = null;
		try {
			// This browser claims its own handoff link and becomes the finisher.
			const h = new URL(handoffUrl).hash.slice(3);
			if (!localFinish) {
				apply(await claimHandoff(h));
				localFinish = true;
			}
			await walletStore.connect(id);
		} catch (err) {
			failure = describeError(err);
		} finally {
			connecting = null;
		}
	}

	async function approveHere() {
		if (!status) return;
		failure = null;
		try {
			apply(await finishInWallet(status.id, walletStore.signingContext(), (p) => (phase = p)));
		} catch (err) {
			failure = describeError(err);
		} finally {
			phase = null;
		}
	}

	async function cancel() {
		if (status && !done && !dead && s !== 'submitted') await cancelLink(status.id).catch(() => {});
		await goto('/accessory');
	}
</script>

<svelte:head><title>{copy.pageTitle} · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col pt-4" aria-live="polite">
		{#key view + (showComputer ? ':computer' : '')}
			<div class="animate-rise flex flex-1 flex-col gap-7">
				{#if view === 'loading'}
					<div class="grid flex-1 place-items-center"><Spinner class="size-5 text-muted-foreground" /></div>
				{:else if view === 'done' && status}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<BondVisual wallet={status.recipient} icon={ownedResult ? walletStore.walletIcon : null} pda={a.pda} hasMint={!!a.mint} />
						<PageHeader
							align="center"
							title={copy.done.title}
							body={copy.done.body(ownedResult, status.recipient ? shortAddress(status.recipient) : 'the wallet you chose')}
						/>
						{#if status.recipient}
							<List><WalletRow address={status.recipient} label={ownedResult ? 'Your wallet' : 'Owned by'} icon={ownedResult ? walletStore.walletIcon : null} /></List>
						{/if}
					</div>
				{:else if view === 'dead'}
					<div class="flex flex-1 flex-col justify-center">
						<Notice
							title={s === 'cancelled' ? copy.cancelled : (failure?.title ?? linkErrorCopy(status?.errorCode).title)}
							body={s === 'cancelled' ? 'Nothing was changed.' : (failure?.body ?? linkErrorCopy(status?.errorCode).body)}
							detail={failure?.detail}
						/>
					</div>
				{:else}
					{#if view === 'tap'}
						<PageHeader step={{ current: 1, total: 2 }} title="Approve with your accessory" body={hint} />
					{:else if view === 'confirm_computer'}
						<PageHeader step={{ current: 1, total: 2 }} title="Confirm on your computer" body="Make sure your computer shows this code, then approve there." />
					{:else if view === 'choose' && showComputer}
						<PageHeader step={{ current: 2, total: 2 }} title="Use a computer" body="Link from a wallet on your computer instead." />
					{:else if view === 'choose'}
						<PageHeader step={{ current: 2, total: 2 }} title={copy.choose.title} body={copy.choose.body} />
					{:else if view === 'local'}
						<PageHeader step={{ current: 2, total: 2 }} title={copy.confirm.title} body={copy.confirm.body} />
					{:else if view === 'desktop_remote'}
						<PageHeader step={{ current: 2, total: 2 }} title="Finish on your computer" body={copy.finishOnComputer} />
					{:else}
						<PageHeader step={{ current: 2, total: 2 }} title="Finish in your wallet" body={copy.finishInWallet} />
					{/if}

					{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}

					{#if status?.claimConflict}
						<Notice title="Opened on another device" body="Your link was opened a second time. If that wasn’t you, cancel and start again." />
					{/if}

					{#if view === 'tap'}
						<div class="grid flex-1 place-items-center py-6">
							<AccessoryMark state={tapping ? 'waiting' : 'idle'} pda={a.pda} hasMint={!!a.mint} />
						</div>
						{#if !webauthnOk}
							<Notice title="Open this page in Safari or Chrome" body="This browser can’t read your accessory." />
						{/if}
					{:else if view === 'confirm_computer'}
						<div class="grid flex-1 place-items-center">
							{#if status?.pairingCode}<PairingCode code={status.pairingCode} caption="Your code" />{/if}
						</div>
					{:else if view === 'choose' && showComputer}
						<ol class="space-y-3 text-[15px]">
							{#each [`On your computer, open ${page.url.host}`, 'Connect your wallet, then choose Link an accessory', 'Scan the code it shows with this phone'] as line, i (line)}
								<li class="flex gap-3">
									<span class="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-medium tabular-nums">{i + 1}</span>
									<span class="pt-0.5">{line}</span>
								</li>
							{/each}
						</ol>
					{:else if view === 'choose' && handoffUrl}
						<HandoffPanel {handoffUrl} options={walletStore.options} {connecting} onpick={useLocalWallet} oncomputer={() => (showComputer = true)} />
					{:else if view === 'local' && walletStore.address}
						<List><WalletRow address={walletStore.address} label={walletStore.walletName ?? 'This wallet'} icon={walletStore.walletIcon} /></List>
					{:else if view === 'remote' || view === 'desktop_remote'}
						<div class="flex items-center gap-3 rounded-[14px] bg-muted px-4 py-3.5 text-[15px]">
							<Spinner class="size-4 text-muted-foreground" />
							<span>
								{#if s === 'submitted'}Confirming on the network…
								{:else if status?.recipient}{copy.progress(shortAddress(status.recipient))}
								{:else if s === 'claimed'}Opened in your wallet
								{:else}Waiting for your wallet…{/if}
							</span>
						</div>
					{/if}

					{#if status?.tapExpiresAt && (view === 'choose' || view === 'local' || view === 'remote' || view === 'desktop_remote')}
						<Countdown until={status.tapExpiresAt} />
					{/if}
				{/if}
			</div>
		{/key}
	</section>

	{#snippet footer()}
		<div class="grid gap-1">
			{#if view === 'done' || view === 'dead'}
				<Button href="/accessory" size="xl" class="w-full">{view === 'done' ? 'Done' : 'Back to your accessory'}</Button>
			{:else if view === 'tap' && webauthnOk}
				<Button size="xl" class="w-full" disabled={tapping || !challenge} onclick={tap}>
					{#if tapping}<Spinner /> Hold your accessory to your phone…{:else if !challenge}<Spinner /> Preparing…{:else}Approve{/if}
				</Button>
			{:else if view === 'local' && walletStore.address}
				<Button size="xl" class="w-full" disabled={!!phase} onclick={approveHere}>
					{#if phase === 'approve'}<Spinner /> Approve in {walletStore.walletName ?? 'your wallet'}…
					{:else if phase === 'confirming'}<Spinner /> Confirming…
					{:else if phase}<Spinner /> Preparing…
					{:else}{copy.action}{/if}
				</Button>
			{:else if view === 'choose' && showComputer}
				<Button variant="secondary" size="xl" class="w-full" onclick={() => (showComputer = false)}>Back</Button>
			{/if}
			{#if view !== 'done' && view !== 'dead'}
				<Button variant="ghost" class="h-11 text-muted-foreground" onclick={cancel}>Cancel</Button>
			{/if}
		</div>
	{/snippet}
</PageShell>
