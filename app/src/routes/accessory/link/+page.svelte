<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onDestroy, onMount } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Spinner } from '#lib/components/ui/spinner/index.ts';
	import AccessoryMark from '#lib/components/app/AccessoryMark.svelte';
	import BondVisual from '#lib/components/app/BondVisual.svelte';
	import Countdown from '#lib/components/app/Countdown.svelte';
	import List from '#lib/components/app/List.svelte';
	import Notice from '#lib/components/app/Notice.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import PageShell from '#lib/components/app/PageShell.svelte';
	import QrCode from '#lib/components/app/QrCode.svelte';
	import WalletConnect from '#lib/components/app/WalletConnect.svelte';
	import WalletRow from '#lib/components/app/WalletRow.svelte';
	import { canTapHere, platform, tapHint } from '#lib/client/capability.ts';
	import {
		finishLink,
		prepareTap,
		tapAccessory,
		type FinishPhase,
		type PreparedTap,
		type TappedAccessory
	} from '#lib/client/link/flow.ts';
	import { describeError, linkErrorCopy, type FriendlyError } from '#lib/client/link/messages.ts';
	import { linkCopy } from '#lib/client/accessory/link-copy.ts';
	import { rememberRecentWallet } from '#lib/client/memory.ts';
	import { walletStore } from '#lib/client/wallet/wallet.svelte.ts';
	import { PASSKEY_WALLET_NAME } from '#lib/client/wallet/passkey.svelte.ts';
	import { walletHoldingsQuery, walletSetupQuery } from '#lib/client/queries.ts';
	import ReceiveSheet from '#lib/components/app/ReceiveSheet.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '#lib/shared/amount.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';
	import { explorerUrl } from '#lib/shared/explorer.ts';
	import { LINK_TX_CONFIG } from '#lib/shared/fee-policy.ts';
	import { networkFeeLamports } from '#lib/shared/wallet-fee.ts';
	import { SYSTEM_ACCOUNT_RENT_LAMPORTS } from '#lib/shared/wallet-transfer.ts';

	let { data } = $props();
	const accessory = $derived(data.accessory);
	const copy = $derived(linkCopy(accessory.kind));

	let prepared = $state.raw<PreparedTap | null>(null);
	let tapped = $state.raw<TappedAccessory | null>(null);
	let linked = $state<{ recipient: string; signature: string } | null>(null);
	let tapping = $state(false);
	let failure = $state<FriendlyError | null>(null);
	let choosing = $state(false);
	let phase = $state<FinishPhase | null>(null);
	let hint = $state('Tap Approve, then hold your accessory to your phone.');
	let webauthnOk = $state(true);
	let device = $state<'pending' | 'desktop' | 'mobile'>('pending');

	// Revibase Passkey pays its claim itself (fee, plus its one-time setup on its
	// first transaction), so check the wallet can before asking for a tap.
	const passkey = $derived(walletStore.walletName === PASSKEY_WALLET_NAME);
	const fundingEnabled = $derived(passkey && !!walletStore.address && !linked);
	const balanceQuery = createQuery(() => ({
		...walletHoldingsQuery(walletStore.address ?? ''),
		enabled: fundingEnabled,
		refetchInterval: 5_000
	}));
	const setupQuery = createQuery(() => ({
		...walletSetupQuery(walletStore.address ?? ''),
		enabled: fundingEnabled
	}));
	/** SOL still to add before this wallet can claim, or 0. */
	const shortBy = $derived.by(() => {
		if (!fundingEnabled || !balanceQuery.data || setupQuery.data === undefined) return 0n;
		// Fee payer + the wallet's check + the tap's check.
		const cost = networkFeeLamports(3, LINK_TX_CONFIG) + setupQuery.data;
		const held = balanceQuery.data.lamports;
		if (held < cost) return cost - held;
		const left = held - cost;
		// What stays must be nothing or keep the account open.
		return left !== 0n && left < SYSTEM_ACCOUNT_RENT_LAMPORTS
			? SYSTEM_ACCOUNT_RENT_LAMPORTS - left
			: 0n;
	});
	let receiving = $state(false);

	type View = 'pending' | 'phone' | 'choose' | 'tap' | 'confirm' | 'done';
	const view = $derived.by((): View => {
		if (device === 'desktop') return 'phone';
		if (linked) return 'done';
		if (device === 'pending') return 'pending';
		if (!walletStore.address) return 'choose';
		if (!tapped) return 'tap';
		return 'confirm';
	});
	const ownedResult = $derived(!!linked && walletStore.address === linked.recipient);

	const STALE_MS = 45_000;
	let staleTimer: ReturnType<typeof setTimeout> | undefined;
	let prepareFailures = 0;
	let challengeEpoch = 0;
	async function refreshChallenge() {
		const recipient = walletStore.address;
		if (!recipient || tapped || tapping) return;
		const epoch = ++challengeEpoch;
		try {
			const next = await prepareTap(accessory.publicKey, recipient);
			if (epoch !== challengeEpoch || walletStore.address !== recipient || tapped) return;
			prepared = next;
			prepareFailures = 0;
			clearTimeout(staleTimer);
			staleTimer = setTimeout(() => void refreshChallenge(), STALE_MS);
		} catch (err) {
			if (epoch === challengeEpoch && ++prepareFailures >= 2) failure = describeError(err);
		}
	}
	onDestroy(() => clearTimeout(staleTimer));

	// The challenge names the connected wallet, so it is fetched only after connect.
	let watching: string | null = null;
	$effect(() => {
		const recipient = walletStore.address;
		if (tapping || phase || linked) return;
		if (recipient === watching) return;
		watching = recipient;
		if (tapped) tapped = null;
		prepared = null;
		clearTimeout(staleTimer);
		if (recipient) void refreshChallenge();
	});

	onMount(() => {
		if (platform() === 'desktop') {
			device = 'desktop';
			return;
		}
		device = 'mobile';
		hint = `Tap Approve, then ${tapHint().charAt(0).toLowerCase()}${tapHint().slice(1)}`;
		webauthnOk = canTapHere();
		walletStore.init(data.cluster);
	});

	function tapExpired() {
		if (phase || linked) return;
		tapped = null;
		failure = linkErrorCopy('too_slow');
		void refreshChallenge();
	}

	async function tap() {
		if (!prepared) return;
		tapping = true;
		failure = null;
		const challenge = prepared;
		prepared = null;
		clearTimeout(staleTimer);
		try {
			tapped = await tapAccessory(challenge);
		} catch (err) {
			failure = describeError(err, 'tap');
		} finally {
			tapping = false;
			if (!tapped) void refreshChallenge();
		}
	}

	async function approveHere() {
		if (!tapped) return;
		const context = walletStore.signingContext();
		failure = null;
		try {
			const signature = await finishLink(tapped, context, (next) => (phase = next));
			linked = { recipient: context.address, signature };
			rememberRecentWallet(context.wallet.name);
		} catch (err) {
			failure = describeError(err);
		} finally {
			phase = null;
		}
	}

	function cancel() {
		void goto('/accessory');
	}
</script>

<svelte:head><title>{copy.pageTitle} · Revibase</title></svelte:head>

<PageShell connect={false}>
	<section class="flex flex-1 flex-col pt-4" aria-live="polite">
		{#key view}
			<div class="animate-rise flex flex-1 flex-col gap-7">
				{#if view === 'phone'}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<PageHeader
							align="center"
							title="Claim on your phone"
							body="Claiming uses your phone’s NFC."
						/>
						<QrCode value={page.url.origin} label="Scan with your phone’s camera" />
					</div>
				{:else if view === 'pending'}
					<div class="flex-1"></div>
				{:else if view === 'done' && linked}
					<div class="flex flex-1 flex-col justify-center gap-8">
						<BondVisual wallet={linked.recipient} pda={accessory.pda} hasMint={!!accessory.mint} />
						<PageHeader
							align="center"
							title={copy.done.title}
							body={copy.done.body(ownedResult, shortAddress(linked.recipient))}
						/>
						<List>
							<WalletRow
								address={linked.recipient}
								label={ownedResult ? 'Your wallet' : undefined}
							/>
						</List>
					</div>
				{:else}
					{#if view === 'choose'}
						<PageHeader
							step={{ current: 1, total: 3 }}
							title={copy.choose.title}
							body={copy.choose.body}
						/>
					{:else if view === 'tap'}
						<PageHeader
							step={{ current: 2, total: 3 }}
							title="Approve with your accessory"
							body={hint}
						/>
					{:else}
						<PageHeader
							step={{ current: 3, total: 3 }}
							title={copy.confirm.title}
							body={accessory.mint ? `${copy.confirm.body} ${copy.nft}` : copy.confirm.body}
						/>
					{/if}

					<Notice error={failure} />

					{#if view === 'choose' || view === 'tap'}
						<div class="grid flex-1 place-items-center py-6">
							<AccessoryMark
								state={tapping ? 'waiting' : 'idle'}
								pda={accessory.pda}
								hasMint={!!accessory.mint}
							/>
						</div>
					{/if}
					{#if view === 'tap'}
						{#if walletStore.address}
							<List>
								<WalletRow address={walletStore.address} label="Your wallet" />
							</List>
							<Button
								variant="quiet"
								class="w-full"
								disabled={tapping}
								onclick={() => (choosing = true)}>Use a different wallet</Button
							>
						{/if}
						{#if shortBy > 0n}
							<Notice
								tone="info"
								title={`Add ${formatCompactTokenAmount(shortBy, SOL_DECIMALS)} SOL to claim`}
								body={`Your wallet pays the network fee${setupQuery.data ? ' and a one-time setup' : ''}.`}
							>
								{#snippet actions()}<Button variant="secondary" onclick={() => (receiving = true)}
										>Receive</Button
									>{/snippet}
							</Notice>
						{/if}
						{#if !webauthnOk}
							<Notice
								title="Open this page in Safari or Chrome"
								body="This browser can’t read your accessory."
							/>
						{/if}
					{:else if view === 'confirm' && walletStore.address}
						<List>
							<WalletRow address={walletStore.address} label="Your wallet" />
						</List>
					{/if}

					{#if tapped && (view === 'choose' || view === 'confirm')}
						<Countdown until={tapped.expiresAt} onexpire={tapExpired} />
					{/if}
				{/if}
			</div>
		{/key}
	</section>

	{#snippet footer()}
		<div class="grid gap-1">
			<!-- Always mounted: "Use a different wallet" reopens the same sheet from the tap step. -->
			<WalletConnect bind:open={choosing} showButton={view === 'choose'} />
			{#if view === 'done' && linked}
				<Button href="/accessory" size="xl" class="w-full">Done</Button>
				<Button
					variant="quiet"
					class="w-full"
					href={explorerUrl('tx', linked.signature, data.cluster)}
					target="_blank"
					rel="noopener noreferrer">View transaction</Button
				>
			{:else if view === 'tap' && webauthnOk}
				<Button
					size="xl"
					class="w-full"
					disabled={tapping || !prepared || shortBy > 0n}
					onclick={tap}
				>
					{#if tapping}<Spinner /> Hold your accessory to your phone…{:else if !prepared}<Spinner /> Preparing…{:else}Approve{/if}
				</Button>
			{:else if view === 'confirm' && walletStore.address}
				<Button size="xl" class="w-full" disabled={!!phase} onclick={approveHere}>
					{#if phase === 'approve'}<Spinner /> {walletStore.approvePrompt}
					{:else if phase === 'confirming'}<Spinner /> Confirming…
					{:else if phase}<Spinner /> Preparing…
					{:else}{copy.action}{/if}
				</Button>
			{/if}
			{#if view !== 'done'}
				<Button variant="quiet" class="w-full" disabled={!!phase} onclick={cancel}>Cancel</Button>
			{/if}
		</div>
	{/snippet}
</PageShell>

{#if walletStore.address && passkey}
	<ReceiveSheet bind:open={receiving} address={walletStore.address} cluster={data.cluster} />
{/if}
