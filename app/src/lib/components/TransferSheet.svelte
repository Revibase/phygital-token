<script lang="ts">
	import type { NftDisplayInfo } from 'phygital-nfts-client';
	import type { TransferSession } from 'phygital-nfts-client';
	import WalletConnect from '$lib/components/WalletConnect.svelte';
	import { txExplorerUrl } from '$lib/explorer';
	import { mapTransferError, shortenAddress } from '$lib/format';
	import {
		authenticateTransferCard,
		createTransferSession,
		submitTransfer
	} from '$lib/transfer';
	import { walletStore } from '$lib/wallet';

	type SheetStep = 'card' | 'confirm' | 'success';

	let {
		nft,
		open = $bindable(false),
		onComplete
	}: {
		nft: NftDisplayInfo;
		open?: boolean;
		onComplete: () => void;
	} = $props();

	let step = $state<SheetStep>('card');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let session = $state<TransferSession | null>(null);
	let webauthnResponse = $state<Awaited<
		ReturnType<typeof authenticateTransferCard>
	> | null>(null);
	let txSignature = $state<string | null>(null);

	const stepNumber = $derived(step === 'card' ? 1 : step === 'confirm' ? 2 : 0);

	function reset() {
		step = 'card';
		busy = false;
		error = null;
		session = null;
		webauthnResponse = null;
		txSignature = null;
	}

	function close() {
		open = false;
		reset();
	}

	$effect(() => {
		if (open) {
			reset();
		}
	});

	async function startCardTap() {
		error = null;
		busy = true;

		try {
			const nextSession = await createTransferSession(nft.mint);
			session = nextSession;
			webauthnResponse = await authenticateTransferCard(nextSession);
			step = 'confirm';
		} catch (tapError) {
			error = mapTransferError(tapError);
			session = null;
			webauthnResponse = null;
		} finally {
			busy = false;
		}
	}

	async function handleConfirm() {
		if (!session || !webauthnResponse) {
			error = 'Session expired. Tap your card again.';
			step = 'card';
			session = null;
			webauthnResponse = null;
			return;
		}

		if (!$walletStore.signer) {
			error = 'Connect your wallet to finish claiming this card.';
			return;
		}

		error = null;
		busy = true;

		try {
			const signature = await submitTransfer(session, webauthnResponse, $walletStore.signer);
			txSignature = signature;
			step = 'success';
			onComplete();
		} catch (confirmError) {
			error = mapTransferError(confirmError);
			session = null;
			webauthnResponse = null;
			step = 'card';
		} finally {
			busy = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="backdrop" role="presentation" onclick={close}></div>

	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="claim-title">
		<header class="sheet-header">
			<button type="button" class="close" onclick={close} aria-label="Close">×</button>
			{#if stepNumber > 0}
				<p class="progress">{stepNumber} of 2</p>
			{/if}
			<h2 id="claim-title">
				{#if step === 'card'}
					Tap your card
				{:else if step === 'confirm'}
					Confirm in wallet
				{:else}
					Card claimed
				{/if}
			</h2>
		</header>

		<div class="sheet-body">
			{#if step === 'card'}
				<div class="nfc-stage">
					<div class="pulse-ring" class:active={busy} aria-hidden="true">
						<svg viewBox="0 0 64 64" class="nfc-icon">
							<path
								d="M32 8c-8 0-14 6-14 14v4c0 2 2 4 4 4h2v-8c0-4 4-8 8-8s8 4 8 8v8h2c2 0 4-2 4-4v-4c0-8-6-14-14-14z"
								fill="currentColor"
							/>
							<path
								d="M20 36h24v20H20z"
								fill="currentColor"
								opacity="0.35"
							/>
							<path
								d="M26 42h12M26 48h8"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
							/>
						</svg>
					</div>
					<p class="lead">Hold your card near your phone.</p>
					<p class="sub">
						Your physical card proves you can claim this card. You'll choose your wallet
						next.
					</p>
				</div>

				<button type="button" class="primary" disabled={busy} onclick={startCardTap}>
					{busy ? 'Waiting for card…' : 'Tap card'}
				</button>
			{:else if step === 'confirm'}
				<div class="summary">
					{#if nft.image}
						<img src={nft.image} alt="" class="thumb" />
					{/if}
					<div>
						<p class="summary-name">{nft.name}</p>
						<p class="summary-status">Ready to claim</p>
					</div>
				</div>

				{#if $walletStore.signer}
					<div class="recipient">
						<span>Your wallet</span>
						<span>{shortenAddress($walletStore.signer.address, 6)}</span>
					</div>
				{:else}
					<p class="lead wallet-prompt">Choose the wallet that will own this card.</p>
					<WalletConnect />
				{/if}

				<button
					type="button"
					class="primary"
					disabled={busy || !$walletStore.signer}
					onclick={handleConfirm}
				>
					{busy ? 'Confirming…' : 'Confirm'}
				</button>
			{:else if step === 'success'}
				<div class="success">
					<div class="check" aria-hidden="true">✓</div>
					<p class="lead">Added to your wallet</p>
					<p class="sub success-name">{nft.name}</p>
					{#if txSignature}
						<a
							class="explorer"
							href={txExplorerUrl(txSignature)}
							target="_blank"
							rel="noreferrer"
						>
							View transaction
						</a>
					{/if}
				</div>
				<button type="button" class="primary" onclick={close}>Done</button>
			{/if}

			{#if error}
				<p class="error">{error}</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: var(--overlay);
		backdrop-filter: blur(4px);
	}

	.sheet {
		position: fixed;
		z-index: 50;
		left: 50%;
		bottom: 0;
		transform: translateX(-50%);
		width: min(100%, 480px);
		max-height: 92vh;
		overflow: auto;
		padding-bottom: env(safe-area-inset-bottom, 0);
		border-radius: 20px 20px 0 0;
		background: var(--card);
		border: 1px solid var(--border);
		border-bottom: 0;
		box-shadow: 0 -20px 60px var(--shadow-color);
		color: var(--card-foreground);
	}

	@media (min-width: 640px) {
		.sheet {
			top: 50%;
			bottom: auto;
			transform: translate(-50%, -50%);
			border-radius: 20px;
			border-bottom: 1px solid var(--border);
		}
	}

	.sheet-header {
		position: relative;
		padding: 1.25rem 1.5rem 0.5rem;
		text-align: center;
	}

	.close {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		width: 36px;
		height: 36px;
		border: 0;
		border-radius: 999px;
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
	}

	.progress {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--muted-foreground);
	}

	h2 {
		margin: 0.35rem 0 0;
		font-size: 1.35rem;
		color: var(--foreground);
	}

	.sheet-body {
		padding: 1rem 1.5rem 1.5rem;
	}

	.lead {
		margin: 0 0 0.5rem;
		font-size: 1rem;
		color: var(--foreground);
		text-align: center;
	}

	.wallet-prompt {
		margin-bottom: 0.75rem;
	}

	.sub {
		margin: 0 0 1.25rem;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--muted-foreground);
		text-align: center;
	}

	.nfc-stage {
		display: grid;
		justify-items: center;
		padding: 1rem 0 1.5rem;
	}

	.pulse-ring {
		width: 120px;
		height: 120px;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: var(--muted);
		border: 1px solid var(--border);
		color: var(--foreground);
		margin-bottom: 1rem;
	}

	.pulse-ring.active {
		animation: pulse 1.6s ease-in-out infinite;
	}

	.nfc-icon {
		width: 56px;
		height: 56px;
	}

	.primary {
		width: 100%;
		min-height: 48px;
		border: 0;
		border-radius: calc(var(--radius) + 4px);
		padding: 0.95rem 1rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--primary-foreground);
		background: var(--primary);
		cursor: pointer;
	}

	.primary:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.summary {
		display: flex;
		gap: 0.85rem;
		align-items: center;
		padding: 0.85rem;
		margin-bottom: 1rem;
		border-radius: calc(var(--radius) + 4px);
		background: var(--muted);
		border: 1px solid var(--border);
	}

	.thumb {
		width: 56px;
		height: 56px;
		border-radius: 10px;
		object-fit: cover;
	}

	.summary-name {
		margin: 0;
		font-weight: 600;
		color: var(--foreground);
	}

	.summary-status {
		margin: 0.2rem 0 0;
		color: var(--foreground);
		font-weight: 600;
		font-size: 0.9rem;
	}

	.recipient {
		display: flex;
		justify-content: space-between;
		padding: 0.65rem 0;
		margin-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.9rem;
		color: var(--muted-foreground);
	}

	.recipient span:last-child {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--foreground);
	}

	.success {
		display: grid;
		justify-items: center;
		gap: 0.5rem;
		padding: 1rem 0 1.5rem;
	}

	.success-name {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--muted-foreground);
	}

	.check {
		width: 64px;
		height: 64px;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: color-mix(in oklch, var(--success) 15%, transparent);
		border: 2px solid var(--success);
		color: var(--success);
		font-size: 1.75rem;
		font-weight: 700;
	}

	.explorer {
		color: var(--foreground);
		font-size: 0.9rem;
	}

	.error {
		margin: 1rem 0 0;
		padding: 0.75rem;
		border-radius: var(--radius);
		background: color-mix(in oklch, var(--destructive) 10%, transparent);
		border: 1px solid color-mix(in oklch, var(--destructive) 35%, transparent);
		color: var(--destructive);
		font-size: 0.88rem;
		text-align: center;
	}

	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--ring) 35%, transparent);
		}
		50% {
			box-shadow: 0 0 0 14px transparent;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse-ring.active {
			animation: none;
		}
	}
</style>
