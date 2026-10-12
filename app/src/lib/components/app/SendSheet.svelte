<script lang="ts">
	import Panel from './Panel.svelte';
	import Loading from './Loading.svelte';
	import Field from './Field.svelte';
	import FieldError from './FieldError.svelte';
	import { SOL_INFO } from '$lib/shared/policy-explain';
	import { address as toAddress } from '@solana/kit';
	import { createQuery } from '@tanstack/svelte-query';
	import { feePreviewQuery } from '$lib/client/queries';
	import { canSpendLamports, WALLET_RENT_EXEMPT_LAMPORTS } from 'phygital-token-sdk';
	import { toast } from 'svelte-sonner';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import Notice from './Notice.svelte';
	import OwnerApproval from './OwnerApproval.svelte';
	import TokenIcon from './TokenIcon.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Spinner } from '$lib/components/ui/spinner';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { recipientAccountFunding, sendFromAccessoryWallet } from '$lib/client/accessory-wallet/send';
	import type { SendAsset } from '$lib/shared/wallet-instructions';
	import { sendAssetRestriction } from '$lib/shared/wallet-instructions';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { formatTokenAmount, sanitizeDecimalInput, SOL_DECIMALS, uiAmountToRaw } from '$lib/shared/amount';
	import { shortAddress } from '$lib/shared/encoding';
	import { isCollectible, type WalletHoldings } from '$lib/shared/wallet-holdings';
	import type { AccessoryView } from '$lib/shared/types';

	let {
		open = $bindable(false),
		accessory,
		cluster,
		holdings,
		asset,
		onsent
	}: { open?: boolean; accessory: AccessoryView; cluster: Cluster; holdings: WalletHoldings | undefined; asset: SendAsset; onsent?: () => void } = $props();

	const uid = $props.id();

	const option = $derived(asset.kind === 'sol'
		? { id: 'sol', label: 'SOL', balance: holdings?.lamports ?? 0n, decimals: SOL_DECIMALS, asset }
		: asset.kind === 'nft' ? { id: asset.nft.id, label: asset.nft.name ?? shortAddress(asset.nft.id), balance: 1n, decimals: 0, asset }
		: { id: asset.token.tokenAccount, label: asset.token.name ?? asset.token.symbol ?? shortAddress(asset.token.mint), balance: asset.token.amount, decimals: asset.token.decimals, asset });
	const collectible = $derived(asset.kind === 'nft' || asset.kind === 'token' && isCollectible(asset.token));
	const restriction = $derived(sendAssetRestriction(asset));
	const artwork = $derived(asset.kind === 'nft' ? asset.nft.icon : asset.kind === 'token' ? asset.token.icon : SOL_INFO.icon);
	let recipient = $state('');
	let recipientOptionsOpen = $state(false);
	let amount = $state('');
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);
	$effect(() => {
		if (!open) { recipientOptionsOpen = false; recipient = ''; amount = ''; failure = null; }
		else if (collectible) amount = '1';
	});
	const validRecipient = $derived.by(() => {
		try {
			return toAddress(recipient.trim());
		} catch {
			return null;
		}
	});

	// A token's first send to someone opens their account, and the accessory wallet pays that rent.
	const opensAccount = createQuery(() => ({
		queryKey: ['opens-token-account', validRecipient, option?.id],
		queryFn: () => recipientAccountFunding(validRecipient!, option!.asset),
		enabled: !!validRecipient && option?.asset.kind !== 'sol',
		staleTime: 30_000
	}));

	const problem = $derived.by(() => {
		if (restriction) return restriction;
		if (!option || !recipient.trim() || !amount) return null;
		if (!validRecipient) return 'Enter a valid Solana address.';
		if (holdings && recipient.trim() === holdings.wallet) return 'That’s this accessory wallet.';
		let raw: bigint;
		try {
			raw = uiAmountToRaw(amount, option.decimals);
		} catch (err) {
			return (err as Error).message;
		}
		if (raw === 0n) return 'Enter an amount greater than zero.';
		if (option.asset.kind !== 'sol' && opensAccount.isError) return 'Couldn’t check the recipient’s token account. Try again.';
		if (raw > option.balance) return 'More than the accessory wallet holds.';
		if (option.asset.kind === 'sol' && !canSpendLamports(option.balance, raw)) {
			return `Leave at least ${formatTokenAmount(WALLET_RENT_EXEMPT_LAMPORTS, SOL_DECIMALS)} SOL, or send it all.`;
		}
		if (opensAccount.data?.rent && holdings && !canSpendLamports(holdings.lamports, opensAccount.data.rent)) {
			return `The accessory wallet needs about ${formatTokenAmount((opensAccount.data?.rent ?? 0n) + WALLET_RENT_EXEMPT_LAMPORTS, SOL_DECIMALS)} SOL for this recipient’s account fees.`;
		}
		return null;
	});
	const ready = $derived(!!option && !!recipient.trim() && !!amount && !problem && !(option.asset.kind !== 'sol' && opensAccount.isFetching));
	const sendingAllSol = $derived.by(() => {
		if (asset.kind !== 'sol' || !amount || problem) return false;
		try { return uiAmountToRaw(amount, SOL_DECIMALS) === option.balance; } catch { return false; }
	});
	// The same query as the fee line below it, so it's computed once.
	const feePreview = createQuery(() => ({ ...feePreviewQuery(accessory.pda, walletStore.address, true), enabled: open && sendingAllSol && walletStore.address === accessory.owner }));

	async function send() {
		if (busy || !option || !ready || walletStore.address !== accessory.owner || sendingAllSol && (feePreview.isPending || feePreview.isError || feePreview.data?.kind === 'blocked')) return;
		busy = true;
		failure = null;
		try {
			await sendFromAccessoryWallet(walletStore.signingContext(), {
				pda: accessory.pda,
				asset: option.asset,
				recipient: recipient.trim(),
				amount: uiAmountToRaw(amount, option.decimals),
				sendAll: option.asset.kind === 'sol' && uiAmountToRaw(amount, option.decimals) === option.balance
			});
			toast.success(option.asset.kind === 'sol' ? 'SOL sent' : `Sent ${amount} ${option.label}`);
			recipient = '';
			amount = '';
			open = false;
			onsent?.();
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

<ResponsiveSheet bind:open title={`Send ${option.label}`} description={collectible ? "Choose where to send this collectible." : "Choose where to send it and how much."}>
	<Notice error={failure} />
	{#if !holdings}
		<Loading text="Loading balances…" />
	{:else}
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); void send(); }}>
			<Panel class="flex items-center gap-3 py-4">
				<TokenIcon src={artwork} label={option.label} {collectible} />
				<div class="min-w-0">
					<p class="truncate text-[15px] font-medium">{option.label}</p>
					<p class="text-[13px] text-muted-foreground">{collectible ? '1 NFT' : `${formatTokenAmount(option.balance, option.decimals)} available`}</p>
				</div>
			</Panel>
			<Field label="Send to" id={`${uid}-recipient`}>
				<div class="relative">
					<Input id={`${uid}-recipient`} bind:value={recipient} disabled={busy} class={accessory.owner ? 'pr-12' : undefined} placeholder="Solana address" autocomplete="off" autocapitalize="off" spellcheck={false} />
					{#if accessory.owner}
						<DropdownMenu.Root bind:open={recipientOptionsOpen}>
							<DropdownMenu.Trigger disabled={busy} aria-label="Choose recipient" class="absolute top-0 right-0 grid size-12 place-items-center rounded-xl text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><ChevronDownIcon class="size-4" /></DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="min-w-64">
								<DropdownMenu.Item class="justify-between gap-4" onSelect={() => { recipient = accessory.owner!; }}><span class="font-medium">Owner</span><span class="text-muted-foreground">{shortAddress(accessory.owner)}</span></DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				</div>
			</Field>
			{#if !collectible}
				<Field label="Amount" id={`${uid}-amount`}>
					{#snippet labelAction()}<Button variant="ghost" size="sm" class="-my-3 text-primary" disabled={busy} onclick={() => (amount = formatTokenAmount(option.balance, option.decimals))}>Max</Button>{/snippet}
					<Input id={`${uid}-amount`} value={amount} oninput={(e) => (amount = sanitizeDecimalInput(e.currentTarget.value))} disabled={busy} inputmode="decimal" placeholder="0.00" aria-invalid={!!problem || undefined} />
				</Field>
			{/if}
			<FieldError message={problem} />
			{#if opensAccount.data?.rent}<p class="text-[13px] text-muted-foreground">Account setup: {formatTokenAmount(opensAccount.data.rent, SOL_DECIMALS)} SOL from this accessory wallet.</p>{/if}
			{#if sendingAllSol}
				<p class="text-[13px] text-muted-foreground">Any required network-fee top-up is deducted before the remaining SOL is sent.</p>
				{#if feePreview.data?.kind === 'refill'}<p class="text-[13px] text-muted-foreground">Estimated fee top-up: {formatTokenAmount(feePreview.data.lamports, SOL_DECIMALS)} SOL.</p>{/if}
				{#if feePreview.isError}<Notice title="Couldn’t estimate fees" onretry={() => void feePreview.refetch()} retrying={feePreview.isFetching} />{/if}
				<FieldError message={feePreview.data?.kind === 'blocked' ? 'Not enough SOL to cover network fees.' : null} />
			{/if}
			<OwnerApproval action="send this asset" {accessory} {cluster} active={open} {busy} drainsWallet={sendingAllSol}>
				<Button type="submit" size="xl" disabled={!ready || busy || (sendingAllSol && (feePreview.isPending || feePreview.isError || feePreview.data?.kind === 'blocked'))}>
					{#if busy}<Spinner /> {walletStore.approvePrompt}{:else if option.asset.kind !== 'sol' && opensAccount.isFetching}Checking recipient…{:else if sendingAllSol && feePreview.isPending}Estimating fees…{:else if sendingAllSol}Send remaining SOL{:else}Send {collectible ? 'collectible' : `${amount || '0'} ${asset.kind === 'token' ? (asset.token.symbol ?? option.label) : option.label}`}{/if}
				</Button>
			</OwnerApproval>
		</form>
	{/if}
</ResponsiveSheet>
