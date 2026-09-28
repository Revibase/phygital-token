<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import * as Alert from '$lib/components/ui/alert';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import Countdown from '$lib/components/app/Countdown.svelte';
	import ErrorCard from '$lib/components/app/ErrorCard.svelte';
	import HandoffPanel from '$lib/components/app/HandoffPanel.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import PairingCode from '$lib/components/app/PairingCode.svelte';
	import StepList, { type Step } from '$lib/components/app/StepList.svelte';
	import TapPrompt from '$lib/components/app/TapPrompt.svelte';
	import WalletChip from '$lib/components/app/WalletChip.svelte';
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
	import { rememberWallet } from '$lib/client/memory';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { shortAddress } from '$lib/shared/encoding';
	import type { LinkStatusView, TransferChallenge } from '$lib/shared/types';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';

	let { data } = $props();
	const a = $derived(data.accessory);

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
	let hint = $state('Hold your accessory to your phone.');
	let webauthnOk = $state(true);

	const poller = new AbortController();
	onDestroy(() => poller.abort());

	const s = $derived(status?.state);
	const isDesktop = $derived(status?.kind === 'desktop');
	const needsTap = $derived(s === 'created' || s === 'awaiting_passkey' || s === 'accessory_confirmed' || (s === 'tapped' && !handoffUrl && !isDesktop));
	const done = $derived(s === 'linked');
	const dead = $derived(s === 'cancelled' || s === 'expired' || s === 'failed');

	const steps = $derived<Step[]>([
		{ label: 'Tap to approve', detail: hint, status: needsTap || !status ? 'active' : 'done' },
		{
			label: isDesktop ? 'Finish on your computer' : 'Finish in your wallet',
			detail: isDesktop ? 'Approve the link in your wallet on the computer.' : 'Choose the wallet this accessory should represent.',
			status: done ? 'done' : needsTap || !status ? 'pending' : 'active'
		}
	]);

	function apply(next: LinkStatusView) {
		status = next;
		if (next.state === 'linked' && next.recipient) rememberWallet(a.pda, next.recipient);
		if ((next.state === 'created' || next.state === 'accessory_confirmed') && next.errorCode === 'too_slow' && !failure) {
			failure = linkErrorCopy('too_slow');
			handoffUrl = null;
		}
	}

	let preparing = false;
	let prepareFailures = 0;
	async function refreshChallenge() {
		if (!status || !needsTap || tapping || preparing) return;
		preparing = true;
		try {
			challenge = await prepareTap(status.id);
			challengeAt = Date.now();
			prepareFailures = 0;
		} catch (err) {
			// Background refresh: only surface it if it keeps failing.
			if (++prepareFailures >= 2) failure = describeError(err);
		} finally {
			preparing = false;
		}
	}

	onMount(async () => {
		hint = tapHint();
		webauthnOk = canTapHere();
		walletStore.init(data.cluster);
		try {
			apply(data.pairedLinkId ? await linkStatus(data.pairedLinkId) : await startPhoneLink());
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
		if (needsTap && !tapping && (!challenge || Date.now() - challengeAt > 45_000)) void refreshChallenge();
	});
	const staleTimer = setInterval(() => {
		if (needsTap && !tapping && Date.now() - challengeAt > 45_000) void refreshChallenge();
	}, 15_000);
	onDestroy(() => clearInterval(staleTimer));

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

<svelte:head><title>Link your wallet · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col gap-6 pt-4">
		{#if done && status}
			<div class="flex flex-1 flex-col items-center justify-center gap-6 text-center" role="status">
				<BondVisual tag={a.tag} />
				<div class="animate-rise space-y-2">
					<h1 class="text-3xl font-semibold">Linked</h1>
					<p class="text-muted-foreground">Your accessory now carries your wallet identity.</p>
				</div>
				{#if status.recipient}<div class="w-full"><WalletChip address={status.recipient} label="Linked wallet" /></div>{/if}
			</div>
		{:else}
			<div class="flex items-center gap-4">
				<AccessoryMark tag={a.tag} size="sm" state={needsTap ? 'waiting' : 'verified'} />
				<div>
					<h1 class="text-xl font-semibold">Link your wallet</h1>
					<p class="text-sm text-muted-foreground">Accessory ••{a.tag}</p>
				</div>
			</div>

			<StepList {steps} />

			{#if status?.claimConflict}
				<Alert.Root variant="destructive" class="rounded-2xl">
					<ShieldAlertIcon />
					<Alert.Title>Opened on another device</Alert.Title>
					<Alert.Description>Someone tried to open your link a second time. If that wasn’t you, cancel and start again.</Alert.Description>
				</Alert.Root>
			{/if}

			{#if failure}
				<ErrorCard title={failure.title} body={failure.body} detail={failure.detail} />
			{/if}

			{#if !status && !failure}
				<div class="grid flex-1 place-items-center"><Spinner class="size-6" /></div>
			{:else if dead}
				<ErrorCard
					title={s === 'cancelled' ? 'Linking cancelled' : linkErrorCopy(status?.errorCode).title}
					body={s === 'cancelled' ? 'Nothing was changed.' : linkErrorCopy(status?.errorCode).body}
				>
					{#snippet actions()}
						<Button href="/accessory" size="lg" class="h-12 rounded-xl">Back to your accessory</Button>
					{/snippet}
				</ErrorCard>
			{:else if s === 'accessory_attached'}
				<!-- Desktop pairing: the computer must confirm this is the accessory it expects. -->
				<div class="space-y-6 rounded-2xl border p-5">
					{#if status?.pairingCode}<PairingCode code={status.pairingCode} caption="Confirm this code on your computer" />{/if}
					<p class="text-center text-sm text-muted-foreground">Waiting for your computer…</p>
				</div>
			{:else if needsTap}
				{#if !webauthnOk}
					<ErrorCard
						title="Open in Safari or Chrome to tap"
						body="This browser can’t read your accessory. Open this page in your phone’s main browser."
					/>
				{:else}
					<TapPrompt {hint} title={tapping ? 'Hold still…' : 'Tap to approve linking'} />
				{/if}
			{:else if isDesktop}
				<div class="flex flex-col items-center gap-3 rounded-2xl border p-6 text-center" role="status" aria-live="polite">
					<Spinner class="size-5" />
					<p class="font-medium">
						{s === 'submitted' ? 'Confirming on the network…' : 'Approve in your wallet on the computer'}
					</p>
					{#if status?.tapExpiresAt}<div class="w-full"><Countdown until={status.tapExpiresAt} total={status.tapWindowMs ?? undefined} /></div>{/if}
				</div>
			{:else if s === 'tapped' && handoffUrl && !localFinish}
				<div class="space-y-4">
					{#if status?.tapExpiresAt}<Countdown until={status.tapExpiresAt} total={status.tapWindowMs ?? undefined} />{/if}
					{#if showComputer}
						<div class="space-y-3 rounded-2xl border p-5 text-sm">
							<p class="font-medium">Link from a computer</p>
							<ol class="list-decimal space-y-1 pl-5 text-muted-foreground">
								<li>On your computer, open <span class="font-mono text-foreground">{page.url.host}/link</span></li>
								<li>Connect your wallet there</li>
								<li>Scan the code it shows with this phone’s camera</li>
							</ol>
							<Button variant="ghost" class="h-11 w-full" onclick={() => (showComputer = false)}>Back</Button>
						</div>
					{:else}
						<HandoffPanel
							{handoffUrl}
							options={walletStore.options}
							{connecting}
							onpick={useLocalWallet}
							oncomputer={() => (showComputer = true)}
						/>
					{/if}
				</div>
			{:else if localFinish && walletStore.address && (s === 'claimed' || s === 'finishing')}
				<div class="space-y-4">
					<WalletChip address={walletStore.address} label={`Link to ${walletStore.walletName ?? 'this wallet'}`} icon={walletStore.walletIcon} />
					{#if status?.tapExpiresAt}<Countdown until={status.tapExpiresAt} total={status.tapWindowMs ?? undefined} />{/if}
				</div>
			{:else}
				<div class="flex flex-col items-center gap-3 rounded-2xl border p-6 text-center" role="status" aria-live="polite">
					<Spinner class="size-5" />
					<p class="font-medium">
						{#if s === 'submitted'}Confirming on the network…
						{:else if status?.recipient}Linking to {shortAddress(status.recipient)}…
						{:else if s === 'claimed'}Opened in your wallet
						{:else}Working…{/if}
					</p>
					<p class="text-sm text-muted-foreground">Finish in your wallet, then come back here.</p>
					{#if status?.tapExpiresAt}<div class="w-full"><Countdown until={status.tapExpiresAt} total={status.tapWindowMs ?? undefined} /></div>{/if}
				</div>
			{/if}
		{/if}
	</section>

	{#snippet footer()}
		<div class="grid gap-2">
			{#if done}
				<Button href="/accessory" size="lg" class="h-14 rounded-xl text-base">Done</Button>
			{:else if needsTap && webauthnOk && status}
				<Button size="lg" class="h-14 rounded-xl text-base" disabled={tapping || !challenge} onclick={tap}>
					{#if tapping}<Spinner /> Waiting for your accessory…{:else if !challenge}<Spinner /> Preparing…{:else}Tap to approve{/if}
				</Button>
			{:else if localFinish && walletStore.address && (s === 'claimed' || s === 'finishing')}
				<Button size="lg" class="h-14 rounded-xl text-base" disabled={!!phase} onclick={approveHere}>
					{#if phase === 'approve'}<Spinner /> Approve in your wallet…{:else if phase}<Spinner /> Preparing…{:else}Link this wallet{/if}
				</Button>
			{/if}
			{#if !done}
				<Button variant="ghost" size="lg" class="h-12 rounded-xl text-muted-foreground" onclick={cancel}>Cancel</Button>
			{/if}
		</div>
	{/snippet}
</PageShell>
