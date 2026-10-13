<script lang="ts">
	import Panel from './Panel.svelte';
	import Loading from './Loading.svelte';
	import Field from './Field.svelte';
	import FieldError from './FieldError.svelte';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import Notice from './Notice.svelte';
	import TokenIcon from './TokenIcon.svelte';
	import { SOL_INFO } from '$lib/shared/policy-explain';
	import { address as toAddress } from '@solana/kit';
	import { createQuery } from '@tanstack/svelte-query';
	import { canSpendLamports, topUpNeeded, WALLET_RENT_EXEMPT_LAMPORTS } from 'phygital-token-sdk';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Spinner } from '$lib/components/ui/spinner';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { recipientAccountFunding } from '$lib/client/accessory-wallet/send';
	import {
		MAX_NETWORK_FEE,
		sendFromPasskeyWallet,
		typicalNetworkFee
	} from '$lib/client/passkey-wallet/send';
	import { sendAssetRestriction, type SendAsset } from '$lib/shared/wallet-instructions';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import {
		formatTokenAmount,
		sanitizeDecimalInput,
		SOL_DECIMALS,
		uiAmountToRaw
	} from '$lib/shared/amount';
	import { shortAddress } from '$lib/shared/encoding';
	import { isCollectible, type WalletHoldings } from '$lib/shared/wallet-holdings';

	/** Send one asset out of the connected passkey wallet. The wallet pays its own network fee. */
	let {
		open = $bindable(false),
		holdings,
		asset
	}: {
		open?: boolean;
		holdings: WalletHoldings | undefined;
		asset: SendAsset;
	} = $props();

	const uid = $props.id();
	const sol = (lamports: bigint) => `${formatTokenAmount(lamports, SOL_DECIMALS)} SOL`;

	const option = $derived(
		asset.kind === 'sol'
			? { id: 'sol', label: 'SOL', balance: holdings?.lamports ?? 0n, decimals: SOL_DECIMALS }
			: asset.kind === 'nft'
				? {
						id: asset.nft.id,
						label: asset.nft.name ?? shortAddress(asset.nft.id),
						balance: 1n,
						decimals: 0
					}
				: {
						id: asset.token.tokenAccount,
						label: asset.token.name ?? asset.token.symbol ?? shortAddress(asset.token.mint),
						balance: asset.token.amount,
						decimals: asset.token.decimals
					}
	);
	const collectible = $derived(
		asset.kind === 'nft' || (asset.kind === 'token' && isCollectible(asset.token))
	);
	const restriction = $derived(sendAssetRestriction(asset));
	const artwork = $derived(
		asset.kind === 'nft'
			? asset.nft.icon
			: asset.kind === 'token'
				? asset.token.icon
				: SOL_INFO.icon
	);
	let recipient = $state('');
	let amount = $state('');
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);
	$effect(() => {
		if (!open) {
			recipient = '';
			amount = '';
			failure = null;
		} else if (collectible) amount = '1';
	});
	const validRecipient = $derived.by(() => {
		try {
			return toAddress(recipient.trim());
		} catch {
			return null;
		}
	});

	// A token's first send to someone opens their account, and this wallet pays that rent.
	const funding = createQuery(() => ({
		queryKey: ['opens-token-account', validRecipient, option.id],
		queryFn: () => recipientAccountFunding(validRecipient!, asset),
		enabled: !!validRecipient && asset.kind !== 'sol',
		staleTime: 30_000
	}));

	const raw = $derived.by(() => {
		try {
			return amount ? uiAmountToRaw(amount, option.decimals) : null;
		} catch {
			return null;
		}
	});
	const sendingAllSol = $derived(asset.kind === 'sol' && raw !== null && raw === option.balance);

	const problem = $derived.by(() => {
		if (restriction) return restriction;
		if (!recipient.trim() || !amount) return null;
		if (!validRecipient) return 'Enter a valid Solana address.';
		if (validRecipient === walletStore.address) return 'That’s this wallet.';
		try {
			uiAmountToRaw(amount, option.decimals);
		} catch (err) {
			return (err as Error).message;
		}
		if (raw === 0n || raw === null) return 'Enter an amount greater than zero.';
		if (raw > option.balance) return 'More than this wallet holds.';
		if (asset.kind !== 'sol' && funding.isError)
			return 'Couldn’t check the recipient’s token account. Try again.';
		const lamports = holdings?.lamports ?? 0n;
		if (sendingAllSol)
			return lamports > MAX_NETWORK_FEE ? null : 'Not enough SOL to cover the network fee.';
		// SOL and account setup come out of the same balance as the fee.
		const spends = MAX_NETWORK_FEE + (asset.kind === 'sol' ? raw : (funding.data?.rent ?? 0n));
		if (canSpendLamports(lamports, spends)) return null;
		return asset.kind === 'sol'
			? `Leave at least ${sol(WALLET_RENT_EXEMPT_LAMPORTS + MAX_NETWORK_FEE)} for the network fee, or send it all.`
			: `Add about ${sol(topUpNeeded(lamports, spends))} to this wallet for the network fee${funding.data?.rent ? ' and the recipient’s account' : ''}.`;
	});
	const ready = $derived(
		!!recipient.trim() && !!amount && !problem && !(asset.kind !== 'sol' && funding.isFetching)
	);

	async function send() {
		if (busy || !ready || raw === null) return;
		busy = true;
		failure = null;
		try {
			await sendFromPasskeyWallet(walletStore.signingContext(), {
				asset,
				recipient: recipient.trim(),
				amount: raw,
				sendAll: sendingAllSol
			});
			toast.success(asset.kind === 'sol' ? 'SOL sent' : `Sent ${amount} ${option.label}`);
			open = false;
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

<ResponsiveSheet
	bind:open
	title={`Send ${option.label}`}
	description="From your passkey wallet to any Solana address."
>
	<Notice error={failure} />
	{#if !holdings}
		<Loading text="Loading balances…" />
	{:else}
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<Panel class="flex items-center gap-3 py-4">
				<TokenIcon src={artwork} label={option.label} {collectible} />
				<div class="min-w-0">
					<p class="truncate text-[15px] font-medium">{option.label}</p>
					<p class="text-[13px] text-muted-foreground">
						{collectible
							? '1 NFT'
							: `${formatTokenAmount(option.balance, option.decimals)} available`}
					</p>
				</div>
			</Panel>
			<Field label="Send to" id={`${uid}-recipient`}>
				<Input
					id={`${uid}-recipient`}
					bind:value={recipient}
					disabled={busy}
					placeholder="Solana address"
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
				/>
			</Field>
			{#if !collectible}
				<Field label="Amount" id={`${uid}-amount`}>
					{#snippet labelAction()}<Button
							variant="ghost"
							size="sm"
							class="-my-3 text-primary"
							disabled={busy}
							onclick={() => (amount = formatTokenAmount(option.balance, option.decimals))}
							>Max</Button
						>{/snippet}
					<Input
						id={`${uid}-amount`}
						value={amount}
						oninput={(e) => (amount = sanitizeDecimalInput(e.currentTarget.value))}
						disabled={busy}
						inputmode="decimal"
						placeholder="0.00"
						aria-invalid={!!problem || undefined}
					/>
				</Field>
			{/if}
			<FieldError message={problem} />
			<p class="text-[13px] text-muted-foreground">
				{#if funding.data?.rent}Account setup: {sol(funding.data.rent)} from this wallet.
				{/if}Network fee: about {sol(typicalNetworkFee())}, paid from this wallet{sendingAllSol
					? ' before the rest is sent'
					: ''}.
			</p>
			<Button type="submit" size="xl" disabled={!ready || busy}>
				{#if busy}<Spinner />
					{walletStore.approvePrompt}{:else if asset.kind !== 'sol' && funding.isFetching}Checking
					recipient…{:else if sendingAllSol}Send all SOL{:else}Send {collectible
						? 'collectible'
						: `${amount || '0'} ${asset.kind === 'token' ? (asset.token.symbol ?? option.label) : option.label}`}{/if}
			</Button>
		</form>
	{/if}
</ResponsiveSheet>
