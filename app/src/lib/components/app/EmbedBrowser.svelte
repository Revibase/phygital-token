<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		SolanaSignAndSendTransaction,
		type SolanaSignAndSendTransactionFeature,
		SolanaSignMessage,
		type SolanaSignMessageFeature,
		SolanaSignTransaction
	} from '@solana/wallet-standard-features';
	import {
		getBase58Encoder,
		getBase64EncodedWireTransaction,
		getTransactionDecoder
	} from '@solana/kit';
	import { Button } from '#lib/components/ui/button/index.ts';
	import WalletConnect from './WalletConnect.svelte';
	import {
		type EmbedHost,
		startEmbedHost,
		type EmbedAccount
	} from '#lib/client/wallet/embed-host.ts';
	import { embedFrameOrigin } from '#lib/shared/wallet-bridge.ts';
	import { browserRpc } from '#lib/client/rpc.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';
	import {
		signWithWallet,
		walletStore,
		type SigningContext
	} from '#lib/client/wallet/wallet.svelte.ts';

	let { href, label, onclose }: { href: string; label: string; onclose: () => void } = $props();

	let frame = $state<HTMLIFrameElement | null>(null);
	let origin = $state<string | null>(null);
	let approval = $state<{ origin: string; accept: (ok: boolean) => void } | null>(null);
	let host = $state<EmbedHost | null>(null);
	let choosing = $state(false);
	// A connect request from the app waits on the same sheet as the header's Connect.
	let connectWaiter: ((ok: boolean) => void) | null = null;
	function settleConnect(ok: boolean) {
		connectWaiter?.(ok);
		connectWaiter = null;
	}
	function requestConnect() {
		settleConnect(false);
		return new Promise<boolean>((resolve) => {
			connectWaiter = resolve;
			choosing = true;
		});
	}
	$effect(() => {
		if (!choosing) settleConnect(false);
	});

	const hostname = $derived.by(() => {
		try {
			return new URL(href).hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
	});

	function account(): EmbedAccount | null {
		try {
			const ctx = walletStore.signingContext();
			return {
				address: ctx.address,
				publicKey: new Uint8Array(ctx.account.publicKey),
				chain: ctx.chain
			};
		} catch {
			return null;
		}
	}

	function requireAccount(chain: string): SigningContext {
		const ctx = walletStore.signingContext();
		if (chain !== ctx.chain) throw new Error('This app asked for a different Solana network.');
		return ctx;
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		origin = embedFrameOrigin(href, window.location.origin);
	});

	$effect(() => {
		const node = frame;
		const expected = origin;
		if (!node || !expected) return;
		const started = startEmbedHost({
			target: window,
			iframe: node,
			expectedOrigin: expected,
			approve: (site) =>
				new Promise((resolve) => {
					approval = { origin: site, accept: resolve };
				}),
			connect: requestConnect,
			signer: {
				account,
				signTransaction: async (bytes, chain) => {
					const ctx = requireAccount(chain);
					// Never fall back to sending: the dapp asked only for a signature.
					// (Revibase Passkey can't return one: its fee payer signs last and sends.)
					if (!(SolanaSignTransaction in ctx.wallet.features))
						throw new Error('This wallet sends transactions itself; use signAndSendTransaction.');
					const outcome = await signWithWallet(ctx, bytes);
					if (outcome.kind !== 'signed')
						throw new Error('This wallet submitted the transaction instead of returning it.');
					return outcome.signedBytes;
				},
				signMessage: async (bytes, chain) => {
					const ctx = requireAccount(chain);
					const features = ctx.wallet.features as Partial<SolanaSignMessageFeature>;
					const sign = features[SolanaSignMessage];
					if (!sign) throw new Error('This wallet can’t sign messages.');
					const [result] = await sign.signMessage({ account: ctx.account, message: bytes });
					return new Uint8Array(result.signature);
				},
				signAndSendTransaction: async (bytes, chain) => {
					const ctx = requireAccount(chain);
					const features = ctx.wallet.features as Partial<SolanaSignAndSendTransactionFeature>;
					const send = features[SolanaSignAndSendTransaction];
					if (send) {
						const [result] = await send.signAndSendTransaction({
							account: ctx.account,
							transaction: bytes,
							chain: ctx.chain
						});
						return Uint8Array.from(result.signature);
					}
					const outcome = await signWithWallet(ctx, bytes);
					if (outcome.kind === 'sent') return Uint8Array.from(outcome.signature);
					const signed = getTransactionDecoder().decode(outcome.signedBytes);
					const signature = await browserRpc()
						.sendTransaction(getBase64EncodedWireTransaction(signed), {
							encoding: 'base64',
							preflightCommitment: 'confirmed'
						})
						.send();
					return Uint8Array.from(getBase58Encoder().encode(signature));
				}
			}
		});
		host = started;
		let announce: ReturnType<typeof setInterval> | null = null;
		const onload = () => {
			let attempts = 0;
			const greet = () => {
				const current = account();
				started.hello();
				started.pushAccounts(current ? [current] : []);
			};
			greet();
			announce = setInterval(() => {
				attempts += 1;
				if (attempts >= 20) {
					if (announce) clearInterval(announce);
					announce = null;
					return;
				}
				greet();
			}, 100);
		};
		node.addEventListener('load', onload);
		node.src = href;
		return () => {
			if (announce) clearInterval(announce);
			node.removeEventListener('load', onload);
			approval?.accept(false);
			approval = null;
			settleConnect(false);
			started.stop();
			if (host === started) host = null;
		};
	});

	$effect(() => {
		const current = account();
		host?.pushAccounts(current ? [current] : []);
	});

	onDestroy(() => {
		approval?.accept(false);
		settleConnect(false);
	});

	function decide(ok: boolean) {
		approval?.accept(ok);
		approval = null;
	}
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-background">
	<header
		class="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3 pt-[env(safe-area-inset-top)]"
	>
		<Button variant="quiet" size="sm" onclick={onclose}>Back</Button>
		<div class="min-w-0 flex-1">
			<p class="truncate text-[15px] font-semibold">{label}</p>
			<p class="truncate text-[12px] text-muted-foreground">{hostname}</p>
		</div>
		{#if walletStore.address}
			<p class="shrink-0 text-[12px] font-medium text-muted-foreground">
				{shortAddress(walletStore.address)}
			</p>
		{:else}
			<Button size="sm" class="shrink-0 rounded-full px-4" onclick={() => (choosing = true)}
				>Connect</Button
			>
		{/if}
		<a
			{href}
			target="_blank"
			rel="noopener noreferrer"
			class="shrink-0 rounded-lg px-2 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
			>New tab</a
		>
	</header>
	{#if origin}
		<iframe
			bind:this={frame}
			title={label}
			sandbox="allow-scripts allow-same-origin allow-forms"
			referrerpolicy="no-referrer"
			class="min-h-0 w-full flex-1 border-0 bg-background {approval ? 'pointer-events-none' : ''}"
		></iframe>
	{:else}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
			<p class="text-[15px] font-medium">This app can’t open here</p>
			<Button {href} target="_blank" rel="noopener noreferrer" variant="secondary"
				>Open in new tab</Button
			>
		</div>
	{/if}
</div>

<WalletConnect bind:open={choosing} showButton={false} onconnected={() => settleConnect(true)} />

{#if approval}
	<div class="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
		<div
			class="w-full max-w-sm rounded-2xl bg-background p-5 shadow-lg"
			role="dialog"
			aria-modal="true"
			aria-labelledby="embed-connect-title"
		>
			<h2 id="embed-connect-title" class="text-[17px] font-semibold">
				Connect to {hostname || label}?
			</h2>
			<p class="mt-2 text-[14px] leading-relaxed text-muted-foreground">
				It will see {walletStore.address ? shortAddress(walletStore.address) : 'your wallet'}. You
				still approve every transaction.
			</p>
			<div class="mt-5 grid gap-2">
				<Button size="xl" onclick={() => decide(true)}>Connect</Button>
				<Button variant="quiet" size="xl" onclick={() => decide(false)}>Cancel</Button>
			</div>
		</div>
	</div>
{/if}
