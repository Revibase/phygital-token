<script lang="ts">
	import { onMount } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import ArrowDownLeft from '@lucide/svelte/icons/arrow-down-left';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import BackupAuthoritySheet from '#lib/components/app/BackupAuthoritySheet.svelte';
	import ListRow from '#lib/components/app/ListRow.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import HoldingsList from '#lib/components/app/HoldingsList.svelte';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import List from '#lib/components/app/List.svelte';
	import Notice from '#lib/components/app/Notice.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import PageShell from '#lib/components/app/PageShell.svelte';
	import ReceiveSheet from '#lib/components/app/ReceiveSheet.svelte';
	import SendSheet from '#lib/components/app/SendSheet.svelte';
	import WalletAccount from '#lib/components/app/WalletAccount.svelte';
	import { walletBackupQuery, walletHoldingsQuery, walletSetupQuery } from '#lib/client/queries.ts';
	import { describeError } from '#lib/client/link/messages.ts';
	import { walletStore } from '#lib/client/wallet/wallet.svelte.ts';
	import { PASSKEY_WALLET_NAME } from '#lib/client/wallet/passkey.svelte.ts';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '#lib/shared/amount.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';
	import { formatUsd, portfolioUsd } from '#lib/shared/wallet-holdings.ts';
	import { needsSolForFees, type SendAsset } from '#lib/shared/wallet-transfer.ts';

	let { data } = $props();

	onMount(() => walletStore.init(data.cluster));

	const query = createQuery(() => ({
		...walletHoldingsQuery(walletStore.address ?? ''),
		enabled: !!walletStore.address
	}));
	const holdings = $derived(walletStore.address ? query.data : undefined);
	const failure = $derived(query.isError && !query.data ? describeError(query.error) : null);
	const passkey = $derived(walletStore.walletName === PASSKEY_WALLET_NAME);
	const setupQuery = createQuery(() => ({
		...walletSetupQuery(walletStore.address ?? ''),
		enabled: passkey && !!walletStore.address
	}));
	const setup = $derived(passkey ? (setupQuery.data ?? 0n) : 0n);
	const backupQuery = createQuery(() => ({
		...walletBackupQuery(walletStore.address ?? ''),
		enabled: passkey && !!walletStore.address
	}));
	const backup = $derived(passkey ? (backupQuery.data ?? null) : null);
	let backupOpen = $state(false);
	let backupMode = $state<'set' | 'remove'>('set');
	function editBackup(mode: 'set' | 'remove') {
		backupMode = mode;
		backupOpen = true;
	}
	const total = $derived.by(() => {
		if (!holdings) return null;
		const usd = portfolioUsd(holdings);
		return usd !== null
			? formatUsd(usd)
			: `${formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)} SOL`;
	});

	let receiving = $state(false);
	let sending = $state(false);
	let asset = $state<SendAsset | null>({ kind: 'sol' });
	function startSend(next: SendAsset | null) {
		asset = next;
		sending = true;
	}
</script>

<svelte:head><title>Wallet · Revibase</title></svelte:head>

<PageShell size="narrow" back>
	<section class="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
		{#if walletStore.address}
			<div class="flex flex-col items-center gap-5">
				<h1 class="sr-only">Wallet</h1>
				<WalletAccount
					address={walletStore.address}
					label={walletStore.walletName ?? 'Your wallet'}
				/>
				{#if total}<p
						class="text-center text-[40px] leading-none font-semibold tracking-tight tabular-nums"
					>
						{total}
					</p>{:else}<div class="h-10 w-44 animate-pulse rounded-lg bg-muted"></div>{/if}
				<div class="grid w-full grid-cols-2 gap-3">
					<Button size="xl" variant="secondary" onclick={() => (receiving = true)}
						><ArrowDownLeft class="size-4" />Receive</Button
					>
					<Button
						size="xl"
						disabled={!holdings}
						onclick={() =>
							startSend(holdings?.tokens.some((t) => !t.frozen) ? null : { kind: 'sol' })}
						><ArrowUpRight class="size-4" />Send</Button
					>
				</div>
			</div>

			<Notice error={failure} onretry={() => void query.refetch()} retrying={query.isFetching} />
			{#if holdings && needsSolForFees(holdings, passkey, setup)}
				<Notice
					tone="info"
					title={setup ? 'Add SOL to get started' : 'Add a little SOL for network fees'}
					body={setup
						? `Your wallet is set up on its first transaction, which costs about ${formatCompactTokenAmount(setup, SOL_DECIMALS)} SOL once, plus a small network fee. Receive some SOL to begin.`
						: 'Every transfer pays a small network fee in SOL from this wallet. Receive some SOL to send your tokens.'}
				/>
			{/if}

			<HoldingsList {holdings} onselect={startSend} />

			{#if passkey}
				<Section
					label="Backup"
					footer="A backup wallet can use this one without your passkey, for example if you lose your device."
				>
					<List>
						<ListRow
							label={backup ? 'Backup wallet' : 'Add a backup'}
							detail={backup ? shortAddress(backup) : 'Only your passkey can use this wallet'}
							busy={backupQuery.isPending}
							chevron
							onclick={() => editBackup('set')}
						>
							{#snippet leading()}<ShieldCheck class="size-5 text-muted-foreground" />{/snippet}
						</ListRow>
						{#if backup}
							<ListRow
								label="Remove backup"
								tone="destructive"
								onclick={() => editBackup('remove')}
							/>
						{/if}
					</List>
				</Section>
			{/if}
		{:else}
			<PageHeader title="Wallet" body="Send and receive SOL and tokens." />
			<EmptyState
				title="No wallet connected"
				body="Connect a wallet on the home page to see it here."
			/>
			<Button href="/" variant="secondary" size="xl">Go to home</Button>
		{/if}
	</section>
</PageShell>

{#if walletStore.address}
	<ReceiveSheet bind:open={receiving} address={walletStore.address} cluster={data.cluster} />
	<SendSheet bind:open={sending} {holdings} {asset} cluster={data.cluster} />
	{#if passkey}
		<BackupAuthoritySheet
			bind:open={backupOpen}
			mode={backupMode}
			current={backup}
			vault={walletStore.address}
			lamports={holdings?.lamports}
			cluster={data.cluster}
		/>
	{/if}
{/if}
