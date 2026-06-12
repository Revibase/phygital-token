<script lang="ts">
	import QRCode from 'qrcode';
	import { cancelWalletConnection, walletConnectUri } from '$lib/wallet';

	let qrDataUrl = $state<string | null>(null);

	$effect(() => {
		const uri = $walletConnectUri;
		if (!uri) {
			qrDataUrl = null;
			return;
		}

		let cancelled = false;
		void QRCode.toDataURL(uri, { margin: 2, width: 256 }).then((url) => {
			if (!cancelled) {
				qrDataUrl = url;
			}
		});

		return () => {
			cancelled = true;
		};
	});

	async function close() {
		await cancelWalletConnection();
	}

	async function copyUri() {
		if (!$walletConnectUri) {
			return;
		}
		await navigator.clipboard.writeText($walletConnectUri);
	}
</script>

{#if $walletConnectUri}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="backdrop" role="presentation" onclick={close}></div>

	<div class="modal" role="dialog" aria-modal="true" aria-labelledby="wc-title">
		<h2 id="wc-title">Connect wallet</h2>
		<p class="lead">Scan with your mobile wallet or approve the connection in your wallet app.</p>

		{#if qrDataUrl}
			<img src={qrDataUrl} alt="WalletConnect QR code" class="qr" />
		{:else}
			<div class="qr-skeleton" aria-hidden="true"></div>
		{/if}

		<button type="button" class="copy" onclick={copyUri}>Copy connection link</button>
		<button type="button" class="cancel" onclick={() => void close()}>Cancel</button>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: var(--overlay);
		backdrop-filter: blur(4px);
	}

	.modal {
		position: fixed;
		z-index: 70;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(calc(100% - 2rem), 360px);
		padding: 1.5rem;
		border-radius: calc(var(--radius) + 6px);
		background: var(--card);
		border: 1px solid var(--border);
		box-shadow: 0 24px 80px var(--shadow-color);
		text-align: center;
	}

	h2 {
		margin: 0 0 0.35rem;
		font-size: 1.2rem;
	}

	.lead {
		margin: 0 0 1rem;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--muted-foreground);
	}

	.qr,
	.qr-skeleton {
		width: 256px;
		height: 256px;
		margin: 0 auto 1rem;
		border-radius: var(--radius);
	}

	.qr-skeleton {
		background: var(--muted);
		animation: pulse 1.2s ease-in-out infinite;
	}

	.copy,
	.cancel {
		width: 100%;
		min-height: 44px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-weight: 600;
		cursor: pointer;
	}

	.copy {
		margin-bottom: 0.5rem;
		background: var(--primary);
		color: var(--primary-foreground);
		border-color: transparent;
	}

	.cancel {
		background: var(--muted);
		color: var(--foreground);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
</style>
