<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Alert from '$lib/components/ui/alert';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import Countdown from '$lib/components/app/Countdown.svelte';
	import ErrorCard from '$lib/components/app/ErrorCard.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import PairingCode from '$lib/components/app/PairingCode.svelte';
	import PairQr from '$lib/components/app/PairQr.svelte';
	import StepList, { type Step } from '$lib/components/app/StepList.svelte';
	import WalletChip from '$lib/components/app/WalletChip.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import { postJson } from '$lib/client/api';
	import { cancelLink, finishInWallet, pollLink, type FinishPhase } from '$lib/client/link/flow';
	import { describeError, linkErrorCopy, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { LinkStatusView } from '$lib/shared/types';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';

	let { data } = $props();

	let status = $state<LinkStatusView | null>(null);
	let pairUrl = $state<string | null>(null);
	let pairExpiresAt = $state(0);
	let failure = $state<FriendlyError | null>(null);
	let connecting = $state<string | null>(null);
	let phase = $state<FinishPhase | null>(null);
	let starting = $state(false);
	let poller: AbortController | null = null;
	onDestroy(() => poller?.abort());

	const s = $derived(status?.state);
	const dead = $derived(s === 'cancelled' || s === 'expired' || s === 'failed' || !!status?.claimConflict);

	const steps = $derived<Step[]>([
		{ label: 'Connect your wallet', status: walletStore.address ? 'done' : 'active' },
		{
			label: 'Scan with your phone',
			detail: 'Then tap your accessory to your phone.',
			status: !walletStore.address ? 'pending' : !status || s === 'pairing' || s === 'paired' ? 'active' : 'done'
		},
		{
			label: 'Confirm your accessory',
			status: s === 'accessory_attached' ? 'active' : s && ['accessory_confirmed', 'awaiting_passkey', 'tapped', 'finishing', 'submitted', 'linked'].includes(s) ? 'done' : 'pending'
		},
		{
			label: 'Approve',
			detail: s === 'tapped' || s === 'finishing' ? 'Approve the link in your wallet.' : 'Tap to approve on your phone.',
			status: s === 'linked' ? 'done' : s && ['accessory_confirmed', 'awaiting_passkey', 'tapped', 'finishing', 'submitted'].includes(s) ? 'active' : 'pending'
		}
	]);

	onMount(() => walletStore.init(data.cluster));

	async function pick(id: string) {
		connecting = id;
		failure = null;
		try {
			await walletStore.connect(id);
			await startPairing();
		} catch (err) {
			failure = describeError(err);
		} finally {
			connecting = null;
		}
	}

	async function startPairing() {
		if (starting) return;
		starting = true;
		failure = null;
		poller?.abort();
		try {
			const res = await postJson<{ status: LinkStatusView; pairUrl: string }>('/api/pair');
			status = res.status;
			pairUrl = res.pairUrl;
			pairExpiresAt = Date.now() + 5 * 60 * 1000;
			poller = new AbortController();
			void pollLink(
				res.status.id,
				(next) => {
					if (!phase) status = next;
					return next.state === 'linked' || next.state === 'cancelled' || next.state === 'expired' || next.state === 'failed';
				},
				poller.signal
			);
		} catch (err) {
			failure = describeError(err);
		} finally {
			starting = false;
		}
	}

	async function confirmAccessory() {
		if (!status) return;
		try {
			status = await postJson<LinkStatusView>(`/api/link/${status.id}/confirm-accessory`);
		} catch (err) {
			failure = describeError(err);
		}
	}

	async function notMine() {
		if (status) await cancelLink(status.id).catch(() => {});
		pairUrl = null;
		status = null;
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

<svelte:head><title>Link from a computer · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col gap-6 pt-4">
		{#if s === 'linked'}
			<div class="flex flex-1 flex-col items-center justify-center gap-6 text-center" role="status">
				<BondVisual tag={status?.accessory?.tag ?? ''} />
				<div class="animate-rise space-y-2">
					<h1 class="text-3xl font-semibold">Linked</h1>
					<p class="text-muted-foreground">Your accessory now carries this wallet’s identity.</p>
				</div>
			</div>
		{:else}
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold">Link from a computer</h1>
				<p class="text-muted-foreground">Use a wallet on this computer. Your phone does the accessory tap.</p>
			</div>
			<StepList {steps} />

			{#if status?.claimConflict}
				<Alert.Root variant="destructive" class="rounded-2xl">
					<ShieldAlertIcon />
					<Alert.Title>Scanned by another phone</Alert.Title>
					<Alert.Description>This code was scanned twice. Start over and keep the code private.</Alert.Description>
				</Alert.Root>
			{/if}
			{#if failure}<ErrorCard title={failure.title} body={failure.body} detail={failure.detail} />{/if}

			{#if !walletStore.address}
				<WalletPicker options={walletStore.options} {connecting} onpick={pick} />
			{:else}
				<WalletChip address={walletStore.address} label={walletStore.walletName ?? 'Connected wallet'} icon={walletStore.walletIcon} />
				{#if dead}
					<ErrorCard
						title={status?.claimConflict ? 'For your safety, start over' : linkErrorCopy(status?.errorCode).title}
						body={s === 'cancelled' ? 'Linking was cancelled. Nothing was changed.' : linkErrorCopy(status?.errorCode).body}
					/>
				{:else if !status || !pairUrl}
					<div class="grid place-items-center py-6"><Spinner class="size-6" /></div>
				{:else if s === 'pairing'}
					<PairQr value={pairUrl} />
					<Countdown until={pairExpiresAt} total={5 * 60 * 1000} />
				{:else if s === 'paired'}
					<div class="flex flex-col items-center gap-4 rounded-2xl border p-6 text-center" role="status" aria-live="polite">
						<AccessoryMark state="waiting" size="sm" />
						<p class="font-medium">Phone connected. Now tap your accessory to your phone.</p>
					</div>
				{:else if s === 'accessory_attached' && status.accessory}
					<div class="space-y-5 rounded-2xl border p-5">
						<div class="flex items-center gap-4">
							<AccessoryMark tag={status.accessory.tag} size="sm" state="verified" />
							<div>
								<p class="font-medium">Accessory ••{status.accessory.tag}</p>
								<p class="text-sm text-muted-foreground">Is this the accessory in your hand?</p>
							</div>
						</div>
						{#if status.pairingCode}<PairingCode code={status.pairingCode} caption="Your phone shows this code too" />{/if}
						{#if status.errorCode === 'accessory_locked' || status.errorCode === 'accessory_permanent'}
							<ErrorCard {...{ title: linkErrorCopy(status.errorCode).title, body: linkErrorCopy(status.errorCode).body }} />
						{/if}
					</div>
				{:else if s === 'tapped' || s === 'finishing'}
					{#if status.tapExpiresAt}<Countdown until={status.tapExpiresAt} total={status.tapWindowMs ?? undefined} />{/if}
				{:else}
					<div class="flex flex-col items-center gap-3 rounded-2xl border p-6 text-center" role="status" aria-live="polite">
						<Spinner class="size-5" />
						<p class="font-medium">{s === 'submitted' ? 'Confirming on the network…' : 'Tap to approve on your phone'}</p>
					</div>
				{/if}
			{/if}
		{/if}
	</section>

	{#snippet footer()}
		<div class="grid gap-2">
			{#if s === 'accessory_attached' && !status?.errorCode}
				<Button size="lg" class="h-14 rounded-xl text-base" onclick={confirmAccessory}>Yes, this is my accessory</Button>
				<Button variant="ghost" size="lg" class="h-12 rounded-xl" onclick={notMine}>No — start over</Button>
			{:else if (s === 'tapped' || s === 'finishing') && walletStore.address}
				<Button size="lg" class="h-14 rounded-xl text-base" disabled={!!phase} onclick={approve}>
					{#if phase === 'approve'}<Spinner /> Approve in your wallet…{:else if phase}<Spinner /> Preparing…{:else}Link this wallet{/if}
				</Button>
			{:else if dead || (s === 'pairing' && pairExpiresAt < Date.now())}
				<Button size="lg" class="h-12 rounded-xl" onclick={startPairing}>Start over</Button>
			{:else if s === 'linked'}
				<Button href="/" variant="outline" size="lg" class="h-12 rounded-xl">Done</Button>
			{/if}
		</div>
	{/snippet}
</PageShell>
