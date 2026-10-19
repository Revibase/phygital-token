<script lang="ts">
	import { untrack } from 'svelte';
	import Field from './Field.svelte';
	import HoldingsList from './HoldingsList.svelte';
	import FieldError from './FieldError.svelte';
	import Notice from './Notice.svelte';
	import Panel from './Panel.svelte';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import TokenIcon from './TokenIcon.svelte';
	import { address as toAddress, type Address } from '@solana/kit';
	import { createQuery } from '@tanstack/svelte-query';
	import { walletSetupQuery } from '#lib/client/queries.ts';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Spinner } from '#lib/components/ui/spinner/index.ts';
	import { walletStore } from '#lib/client/wallet/wallet.svelte.ts';
	import { PASSKEY_WALLET_NAME } from '#lib/client/wallet/passkey.svelte.ts';
	import { explorerUrl } from '#lib/shared/explorer.ts';
	import { planTransfer, sendTransfer, type TransferPlan } from '#lib/client/wallet/send.ts';
	import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
	import {
		formatCompactTokenAmount,
		formatTokenAmount,
		sanitizeDecimalInput,
		SOL_DECIMALS,
		uiAmountToRaw
	} from '#lib/shared/amount.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';
	import { tokenLabel, type WalletHoldings } from '#lib/shared/wallet-holdings.ts';
	import { maxSendable, transferFeeLamports, type SendAsset } from '#lib/shared/wallet-transfer.ts';

	/**
	 * Send SOL or a token from the connected wallet. It looks and reads the same for
	 * every wallet: the network fee always comes out of this wallet, whether the
	 * wallet pays it directly or (Revibase Passkey) repays the fee payer that does.
	 */
	let {
		open = $bindable(false),
		holdings,
		asset,
		cluster
	}: {
		open?: boolean;
		holdings: WalletHoldings | undefined;
		/** null: choose what to send first. */
		asset: SendAsset | null;
		cluster: string;
	} = $props();

	const uid = $props.id();
	const sol = (lamports: bigint) => `${formatCompactTokenAmount(lamports, SOL_DECIMALS)} SOL`;

	const passkey = $derived(walletStore.walletName === PASSKEY_WALLET_NAME);
	// Revibase Passkey's first transaction also sets up the wallet (once).
	const setupQuery = createQuery(() => ({
		...walletSetupQuery(walletStore.address ?? ''),
		enabled: passkey && !!walletStore.address && open
	}));
	const setup = $derived(passkey ? (setupQuery.data ?? 0n) : 0n);
	let chosen = $state<SendAsset | null>(null);
	$effect(() => {
		if (open) untrack(() => (chosen = asset));
	});
	const current = $derived<SendAsset>(chosen ?? { kind: 'sol' });
	const label = $derived(current.kind === 'sol' ? 'SOL' : tokenLabel(current.token));
	const decimals = $derived(current.kind === 'sol' ? SOL_DECIMALS : current.token.decimals);
	const balance = $derived(
		current.kind === 'sol' ? (holdings?.lamports ?? 0n) : current.token.amount
	);
	const icon = $derived(current.kind === 'sol' ? '/solana.svg' : current.token.icon);

	function choose(next: SendAsset | null) {
		chosen = next;
		amount = '';
		plan = null;
		failure = null;
	}

	let recipient = $state('');
	let amount = $state('');
	let plan = $state<TransferPlan | null>(null);
	let busy = $state<'review' | 'send' | null>(null);
	let failure = $state<FriendlyError | null>(null);

	$effect(() => {
		if (!open) {
			recipient = '';
			amount = '';
			plan = null;
			failure = null;
		}
	});

	const validRecipient = $derived.by((): Address | null => {
		try {
			return toAddress(recipient.trim());
		} catch {
			return null;
		}
	});
	const raw = $derived.by(() => {
		try {
			return amount ? uiAmountToRaw(amount, decimals) : null;
		} catch {
			return null;
		}
	});
	const formProblem = $derived.by(() => {
		if (recipient.trim() && !validRecipient) return 'Enter a valid Solana address.';
		if (amount && raw === null) {
			try {
				uiAmountToRaw(amount, decimals);
			} catch (err) {
				return (err as Error).message;
			}
		}
		if (raw !== null && raw > balance) return 'That’s more than this wallet holds.';
		return null;
	});
	const ready = $derived(!!validRecipient && raw !== null && !formProblem);

	// Any edit invalidates the review.
	$effect(() => {
		void recipient;
		void amount;
		plan = null;
	});

	function setMax() {
		if (!holdings) return;
		amount = formatTokenAmount(maxSendable(holdings, current, passkey, false, setup), decimals);
	}

	async function review() {
		if (!holdings || !validRecipient || raw === null) return;
		busy = 'review';
		failure = null;
		try {
			plan = await planTransfer(
				walletStore.signingContext(),
				holdings,
				current,
				validRecipient,
				raw
			);
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = null;
		}
	}

	async function send() {
		if (!plan || plan.problem) return;
		busy = 'send';
		failure = null;
		try {
			const signature = await sendTransfer(walletStore.signingContext(), plan);
			toast.success(`Sent ${amount} ${label}`, {
				description: `To ${shortAddress(plan.request.recipient)}`,
				action: {
					label: 'View',
					onClick: () => window.open(explorerUrl('tx', signature, cluster), '_blank', 'noopener')
				}
			});
			open = false;
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = null;
		}
	}
</script>

<ResponsiveSheet
	bind:open
	title={chosen ? `Send ${label}` : 'Send'}
	description={chosen ? undefined : 'Choose what to send.'}
>
	{#if !chosen}
		<HoldingsList {holdings} label={null} onselect={choose} />
	{:else}
		<Notice error={failure} />
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				void (plan && !plan.problem ? send() : review());
			}}
		>
			<Panel class="flex items-center gap-3 py-4">
				<TokenIcon src={icon} {label} />
				<div class="min-w-0 flex-1">
					<p class="truncate text-[15px] font-medium">{label}</p>
					<p class="text-[13px] text-muted-foreground">
						{formatCompactTokenAmount(balance, decimals)} available
					</p>
				</div>
				{#if asset === null}
					<Button
						variant="ghost"
						size="sm"
						class="text-primary"
						disabled={!!busy}
						onclick={() => choose(null)}>Change</Button
					>
				{/if}
			</Panel>
			<Field label="Send to" id={`${uid}-recipient`}>
				<Input
					id={`${uid}-recipient`}
					bind:value={recipient}
					disabled={!!busy}
					placeholder="Solana address"
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
				/>
			</Field>
			<Field label="Amount" id={`${uid}-amount`}>
				{#snippet labelAction()}<Button
						variant="ghost"
						size="sm"
						class="-my-3 text-primary"
						disabled={!!busy || !holdings}
						onclick={setMax}>Max</Button
					>{/snippet}
				<Input
					id={`${uid}-amount`}
					value={amount}
					oninput={(e) => (amount = sanitizeDecimalInput(e.currentTarget.value))}
					disabled={!!busy}
					inputmode="decimal"
					placeholder="0.00"
					aria-invalid={!!formProblem || !!plan?.problem || undefined}
				/>
			</Field>
			<FieldError message={formProblem ?? plan?.problem} />

			{#if plan && !plan.problem}
				<Panel class="space-y-2 py-4 text-[14px]">
					<div class="flex justify-between gap-3">
						<span class="text-muted-foreground">To</span>
						<span class="font-mono text-[13px]">{shortAddress(plan.request.recipient)}</span>
					</div>
					<div class="flex justify-between gap-3">
						<span class="text-muted-foreground">Amount</span>
						<span>{amount} {label}</span>
					</div>
					{#if plan.cost.accountRent}
						<div class="flex justify-between gap-3">
							<span class="text-muted-foreground">Recipient’s token account</span>
							<span>{sol(plan.cost.accountRent)}</span>
						</div>
					{/if}
					<div class="flex justify-between gap-3">
						<span class="text-muted-foreground">Network fee</span>
						<span>{sol(plan.cost.fee)}</span>
					</div>
					{#if plan.cost.setup}
						<div class="flex justify-between gap-3">
							<span class="text-muted-foreground">Wallet setup (one time)</span>
							<span>{sol(plan.cost.setup)}</span>
						</div>
					{/if}
					<div class="flex justify-between gap-3 border-t pt-2 font-medium">
						<span>Total from this wallet</span>
						<span
							>{current.kind === 'sol'
								? sol(plan.cost.solOut)
								: `${amount} ${label} + ${sol(plan.cost.solOut)}`}</span
						>
					</div>
				</Panel>
			{:else}
				<p class="text-[13px] text-muted-foreground">
					Network fee about {sol(transferFeeLamports(passkey))}{setup
						? `, plus ${sol(setup)} one-time setup`
						: ''}.
				</p>
			{/if}

			<Button type="submit" size="xl" disabled={!ready || !!busy || !!plan?.problem}>
				{#if busy === 'send'}<Spinner /> {walletStore.approvePrompt}
				{:else if busy === 'review'}<Spinner /> Checking…
				{:else if plan && !plan.problem}Send {amount} {label}
				{:else}Review{/if}
			</Button>
		</form>
	{/if}
</ResponsiveSheet>
