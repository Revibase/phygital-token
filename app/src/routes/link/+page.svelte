<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import BondVisual from '$lib/components/app/BondVisual.svelte';
	import Countdown from '$lib/components/app/Countdown.svelte';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import PairingCode from '$lib/components/app/PairingCode.svelte';
	import PairQr from '$lib/components/app/PairQr.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import { postJson } from '$lib/client/api';
	import { cancelLink, finishInWallet, pollLink, type FinishPhase } from '$lib/client/link/flow';
	import { describeError, linkErrorCopy, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { LinkStatusView } from '$lib/shared/types';

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

	type View = 'connect' | 'starting' | 'scan' | 'paired' | 'confirm' | 'approve_phone' | 'sign' | 'submitted' | 'done' | 'dead';
	const view = $derived.by((): View => {
		if (s === 'linked') return 'done';
		if (!walletStore.address) return 'connect';
		if (dead) return 'dead';
		if (!status || !pairUrl) return 'starting';
		if (s === 'pairing') return 'scan';
		if (s === 'paired') return 'paired';
		if (s === 'accessory_attached') return 'confirm';
		if (s === 'tapped' || s === 'finishing') return 'sign';
		if (s === 'submitted') return 'submitted';
		return 'approve_phone';
	});

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
	<section class="flex flex-1 flex-col pt-4" aria-live="polite">
		{#key view}
			<div class="animate-rise flex flex-1 flex-col gap-7">
				{#if view === 'done'}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<BondVisual wallet={status?.recipient ?? walletStore.address} icon={walletStore.walletIcon} pda={status?.accessory?.pda} />
						<!-- The wallet connected on this computer signed the link, so "your wallet" is proven. -->
						<PageHeader align="center" title="Linked" body="Your accessory now signs in as your wallet." />
					</div>
				{:else}
					{#if view === 'connect'}
						<PageHeader step={{ current: 1, total: 3 }} title="Link from a computer" body="Connect the wallet this accessory should sign in as." />
					{:else if view === 'scan' || view === 'starting'}
						<PageHeader step={{ current: 2, total: 3 }} title="Scan with your phone" body="Point your phone’s camera at this code." />
					{:else if view === 'paired'}
						<PageHeader step={{ current: 2, total: 3 }} eyebrow="Phone connected" eyebrowTone="success" title="Now tap your accessory" body="Hold it to your phone." />
					{:else if view === 'confirm'}
						<PageHeader step={{ current: 2, total: 3 }} eyebrow={status?.accessory ? `Accessory · ${status.accessory.tag}` : undefined} title="Is this your accessory?" body="Check that your phone shows the same code." />
					{:else if view === 'approve_phone'}
						<PageHeader step={{ current: 3, total: 3 }} title="Approve on your phone" body="Tap Approve, then hold your accessory to your phone." />
					{:else if view === 'sign'}
						<PageHeader step={{ current: 3, total: 3 }} title="Link this wallet?" body="Anyone holding this accessory will be able to sign in as it." />
					{:else if view === 'submitted'}
						<PageHeader step={{ current: 3, total: 3 }} title="Almost done" />
					{:else if view === 'dead'}
						<PageHeader title={status?.claimConflict ? 'Start over' : 'Linking stopped'} />
					{/if}

					{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}

					{#if view === 'connect'}
						<WalletPicker options={walletStore.options} {connecting} onpick={pick} emptyHint="Install a Solana wallet extension, then reload this page." />
					{:else if view === 'starting'}
						<div class="grid flex-1 place-items-center"><Spinner class="size-5 text-muted-foreground" /></div>
					{:else if view === 'scan' && pairUrl}
						<PairQr value={pairUrl} label="Only scan this with your own phone." />
						<Countdown until={pairExpiresAt} />
					{:else if view === 'paired'}
						<div class="grid flex-1 place-items-center py-4"><AccessoryMark state="waiting" /></div>
					{:else if view === 'confirm'}
						<div class="grid place-items-center py-2">
							{#if status?.pairingCode}<PairingCode code={status.pairingCode} caption="Code" />{/if}
						</div>
						{#if status?.errorCode === 'accessory_locked' || status?.errorCode === 'accessory_permanent'}
							<Notice title={linkErrorCopy(status.errorCode).title} body={linkErrorCopy(status.errorCode).body} />
						{/if}
					{:else if view === 'approve_phone' || view === 'submitted'}
						<div class="flex items-center gap-3 rounded-[14px] bg-muted px-4 py-3.5 text-[15px]">
							<Spinner class="size-4 text-muted-foreground" />
							{view === 'submitted' ? 'Confirming on the network…' : 'Waiting for your phone…'}
						</div>
					{:else if view === 'sign' && walletStore.address}
						<List><WalletRow address={walletStore.address} label={walletStore.walletName ?? 'This wallet'} icon={walletStore.walletIcon} /></List>
						{#if status?.tapExpiresAt}<Countdown until={status.tapExpiresAt} />{/if}
					{:else if view === 'dead'}
						<Notice
							title={status?.claimConflict ? 'Scanned by another phone' : linkErrorCopy(status?.errorCode).title}
							body={status?.claimConflict
								? 'This code was scanned twice. For your safety, start over and keep the code to yourself.'
								: s === 'cancelled'
									? 'Linking was cancelled. Nothing was changed.'
									: linkErrorCopy(status?.errorCode).body}
						/>
					{/if}
				{/if}
			</div>
		{/key}
	</section>

	{#snippet footer()}
		<div class="grid gap-1">
			{#if view === 'confirm' && !status?.errorCode}
				<Button size="xl" class="w-full" onclick={confirmAccessory}>Yes, continue</Button>
				<Button variant="ghost" class="h-11 text-muted-foreground" onclick={notMine}>No, start over</Button>
			{:else if view === 'sign'}
				<Button size="xl" class="w-full" disabled={!!phase} onclick={approve}>
					{#if phase === 'approve'}<Spinner /> Approve in {walletStore.walletName ?? 'your wallet'}…
					{:else if phase === 'confirming'}<Spinner /> Confirming…
					{:else if phase}<Spinner /> Preparing…
					{:else}Link wallet{/if}
				</Button>
			{:else if view === 'dead' || (view === 'scan' && pairExpiresAt < Date.now()) || (view === 'confirm' && status?.errorCode)}
				<Button size="xl" class="w-full" onclick={startPairing}>Start over</Button>
			{:else if view === 'done'}
				<Button href="/" variant="secondary" size="xl" class="w-full">Done</Button>
			{/if}
		</div>
	{/snippet}
</PageShell>
