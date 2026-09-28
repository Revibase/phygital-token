<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Drawer from '$lib/components/ui/drawer';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from './AccessoryMark.svelte';
	import BondVisual from './BondVisual.svelte';
	import Countdown from './Countdown.svelte';
	import List from './List.svelte';
	import Notice from './Notice.svelte';
	import PageHeader from './PageHeader.svelte';
	import PairingCode from './PairingCode.svelte';
	import PairQr from './PairQr.svelte';
	import WalletRow from './WalletRow.svelte';
	import { postJson } from '$lib/client/api';
	import { cancelLink, finishInWallet, pollLink, type FinishPhase } from '$lib/client/link/flow';
	import { describeError, linkErrorCopy, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { LinkStatusView } from '$lib/shared/types';

	/**
	 * Link an accessory to the wallet connected on this computer. The tap can
	 * only happen on a phone, so: this sheet shows a QR → the phone scans it and
	 * taps the accessory → both screens show the same code → the phone approves
	 * with a second tap → this computer's wallet signs.
	 * Opening the sheet starts a pairing; closing it before success cancels it.
	 */
	let { open = $bindable(false), onlinked }: { open?: boolean; onlinked?: () => void } = $props();

	let status = $state<LinkStatusView | null>(null);
	let pairUrl = $state<string | null>(null);
	let pairExpiresAt = $state(0);
	let failure = $state<FriendlyError | null>(null);
	let phase = $state<FinishPhase | null>(null);
	let starting = false;
	let poller: AbortController | null = null;
	onDestroy(() => poller?.abort());

	const s = $derived(status?.state);
	const dead = $derived(s === 'cancelled' || s === 'expired' || s === 'failed' || !!status?.claimConflict);

	type View = 'starting' | 'scan' | 'paired' | 'confirm' | 'approve_phone' | 'sign' | 'submitted' | 'done' | 'dead';
	const view = $derived.by((): View => {
		if (s === 'linked') return 'done';
		if (dead) return 'dead';
		if (!status || !pairUrl) return 'starting';
		if (s === 'pairing') return 'scan';
		if (s === 'paired') return 'paired';
		if (s === 'accessory_attached') return 'confirm';
		if (s === 'tapped' || s === 'finishing') return 'sign';
		if (s === 'submitted') return 'submitted';
		return 'approve_phone';
	});
	let notified = false;
	function linked() {
		if (notified) return;
		notified = true;
		onlinked?.();
	}

	// Open → start a pairing. Close before success → cancel it server-side.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) void startPairing();
		if (!open && wasOpen) void reset();
		wasOpen = open;
	});

	async function startPairing() {
		if (starting) return;
		starting = true;
		notified = false;
		failure = null;
		poller?.abort();
		status = null;
		pairUrl = null;
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
					if (next.state === 'linked') linked();
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

	async function reset() {
		poller?.abort();
		if (status && s !== 'linked' && s !== 'submitted' && !dead) await cancelLink(status.id).catch(() => {});
		status = null;
		pairUrl = null;
		failure = null;
		phase = null;
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
		await startPairing();
	}

	async function approve() {
		if (!status) return;
		failure = null;
		try {
			status = await finishInWallet(status.id, walletStore.signingContext(), (p) => (phase = p));
			if (status.state === 'linked') linked();
		} catch (err) {
			failure = describeError(err);
		} finally {
			phase = null;
		}
	}
</script>

<Drawer.Root bind:open>
	<Drawer.Content>
		<div class="mx-auto w-full max-w-md px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]" aria-live="polite">
			{#key view}
				<div class="animate-rise space-y-6">
					{#if view === 'done'}
						<div class="space-y-6 py-4">
							<BondVisual wallet={status?.recipient ?? walletStore.address} icon={walletStore.walletIcon} pda={status?.accessory?.pda} />
							<!-- This computer's connected wallet just signed, so "your wallet" is proven. -->
							<PageHeader align="center" title="Linked" body="Your accessory now signs in as your wallet." />
						</div>
					{:else}
						{#if view === 'scan' || view === 'starting'}
							<PageHeader step={{ current: 1, total: 2 }} title="Scan with your phone" body="Point your phone’s camera at this code, then tap your accessory to your phone." />
						{:else if view === 'paired'}
							<PageHeader step={{ current: 1, total: 2 }} eyebrow="Phone connected" eyebrowTone="success" title="Now tap your accessory" body="Hold it to your phone." />
						{:else if view === 'confirm'}
							<PageHeader step={{ current: 1, total: 2 }} eyebrow={status?.accessory ? `Accessory · ${status.accessory.tag}` : undefined} title="Is this your accessory?" body="Check that your phone shows the same code." />
						{:else if view === 'approve_phone'}
							<PageHeader step={{ current: 2, total: 2 }} title="Approve on your phone" body="Tap Approve, then hold your accessory to your phone." />
						{:else if view === 'sign'}
							<PageHeader step={{ current: 2, total: 2 }} title="Link this wallet?" body="Anyone holding this accessory will be able to sign in as it." />
						{:else if view === 'submitted'}
							<PageHeader step={{ current: 2, total: 2 }} title="Almost done" />
						{:else}
							<PageHeader title={status?.claimConflict ? 'Start over' : 'Linking stopped'} />
						{/if}

						{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}

						{#if view === 'starting'}
							<div class="grid aspect-square w-full max-w-60 place-items-center justify-self-center"><Spinner class="size-5 text-muted-foreground" /></div>
						{:else if view === 'scan' && pairUrl}
							<PairQr value={pairUrl} label="Only scan this with your own phone." />
							<Countdown until={pairExpiresAt} />
						{:else if view === 'paired'}
							<div class="grid place-items-center py-6"><AccessoryMark state="waiting" /></div>
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
							<List><WalletRow address={walletStore.address} label="Your wallet" icon={walletStore.walletIcon} /></List>
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
							<Button size="xl" class="w-full" onclick={() => (open = false)}>Done</Button>
						{/if}
						{#if view !== 'done' && view !== 'confirm'}
							<Button variant="ghost" class="h-11 text-muted-foreground" onclick={() => (open = false)}>Cancel</Button>
						{/if}
					</div>
				</div>
			{/key}
		</div>
	</Drawer.Content>
</Drawer.Root>
