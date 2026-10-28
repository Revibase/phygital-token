'use client';

import {
	getBase58Encoder,
	getBase64EncodedWireTransaction,
	getTransactionDecoder
} from '@solana/kit';
import { SquareArrowOutUpRight, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { copyText } from '#lib/client/clipboard.ts';
import { browserRpc } from '#lib/client/rpc.ts';
import {
	connectWhenReady,
	startEmbedHost,
	type EmbedAccount,
	type EmbedHost
} from '#lib/client/wallet/embed-host.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { signWithWallet, type SigningContext } from '#lib/client/wallet/wallet.ts';
import { Button, buttonVariants } from '#lib/components/ui/button';
import { Skeleton } from '#lib/components/ui/skeleton';
import { Spinner } from '#lib/components/ui/spinner';
import { shortAddress } from '#lib/shared/encoding.ts';
import { embedFrameOrigin } from '#lib/shared/wallet-bridge.ts';
import { WalletConnect } from './WalletConnect';

export function EmbedBrowser({
	href,
	label,
	onClose
}: {
	href: string;
	label: string;
	onClose: () => void;
}) {
	const wallet = useWallet();
	// The bridge outlives renders, so it reads the wallet through this ref, never a stale closure.
	const walletRef = useRef(wallet);
	const readyWaiters = useRef<(() => void)[]>([]);
	const frame = useRef<HTMLIFrameElement>(null);
	const host = useRef<EmbedHost | null>(null);
	const connectWaiter = useRef<((ok: boolean) => void) | null>(null);
	const [origin, setOrigin] = useState<string | null>(null);
	const [approval, setApproval] = useState<{
		origin: string;
		accept: (ok: boolean) => void;
	} | null>(null);
	const [approvalArmed, setApprovalArmed] = useState(false);
	const [choosing, setChoosing] = useState(false);
	const [copied, setCopied] = useState(false);
	/** The page hasn't loaded after a while. A cross-origin frame can't report why, so offer a reload. */
	const [slow, setSlow] = useState(false);
	const [attempt, setAttempt] = useState(0);
	/** Until the first load, a cross-origin frame is blank; cover it so the wait reads as loading. */
	const [loaded, setLoaded] = useState(false);
	const hostname = (() => {
		try {
			return new URL(href).hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
	})();

	function settleConnect(ok: boolean) {
		connectWaiter.current?.(ok);
		connectWaiter.current = null;
	}

	useLayoutEffect(() => {
		walletRef.current = wallet;
	});

	useEffect(() => {
		if (wallet.ready) for (const resolve of readyWaiters.current.splice(0)) resolve();
	}, [wallet.ready]);

	/** Resolves once the shell has restored its session (Privy and its wallets), right away if it has. */
	function walletReady(): Promise<void> {
		if (walletRef.current.ready) return Promise.resolve();
		return new Promise((resolve) => readyWaiters.current.push(resolve));
	}

	function account(): EmbedAccount | null {
		try {
			const ctx = walletRef.current.signingContext();
			return { address: ctx.address, publicKey: new Uint8Array(ctx.publicKey), chain: ctx.chain };
		} catch {
			return null;
		}
	}

	function requireAccount(chain: string): SigningContext {
		const ctx = walletRef.current.signingContext();
		if (chain !== ctx.chain) throw new Error('This app asked for a different Solana network.');
		return ctx;
	}

	useEffect(() => {
		setOrigin(embedFrameOrigin(href, window.location.origin));
	}, [href]);

	useEffect(() => {
		const node = frame.current;
		if (!node || !origin) return;
		const started = startEmbedHost({
			target: window,
			iframe: node,
			expectedOrigin: origin,
			approve: (site) =>
				new Promise((resolve) => {
					setApproval({ origin: site, accept: resolve });
				}),
			connect: (silent) =>
				connectWhenReady({
					ready: walletReady,
					account,
					choose: silent
						? async () => false
						: () => {
								settleConnect(false);
								return new Promise<boolean>((resolve) => {
									connectWaiter.current = resolve;
									setChoosing(true);
								});
							}
				}),
			signer: {
				account,
				signTransaction: async (bytes, chain) => {
					const ctx = requireAccount(chain);
					if (!ctx.signTransaction)
						throw new Error('This wallet can’t return a signed transaction.');
					const outcome = await signWithWallet(ctx, bytes);
					if (outcome.kind !== 'signed')
						throw new Error('This wallet submitted the transaction instead of returning it.');
					return outcome.signedBytes;
				},
				signMessage: async (bytes, chain) => {
					const ctx = requireAccount(chain);
					if (!ctx.signMessage) throw new Error('This wallet can’t sign messages.');
					return ctx.signMessage(bytes);
				},
				signAndSendTransaction: async (bytes, chain) => {
					const ctx = requireAccount(chain);
					if (ctx.signAndSendTransaction) return ctx.signAndSendTransaction(bytes);
					const outcome = await signWithWallet(ctx, bytes);
					if (outcome.kind === 'sent') return outcome.signature;
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
		host.current = started;
		setSlow(false);
		setLoaded(false);
		const slowTimer = setTimeout(() => setSlow(true), 12_000);
		const onload = () => {
			clearTimeout(slowTimer);
			setSlow(false);
			setLoaded(true);
		};
		node.addEventListener('load', onload);
		node.src = href;
		return () => {
			clearTimeout(slowTimer);
			node.removeEventListener('load', onload);
			setApproval((current) => {
				current?.accept(false);
				return null;
			});
			settleConnect(false);
			started.stop();
			if (host.current === started) host.current = null;
		};
		// The host is rebuilt when the frame origin changes. Wallet methods are read at call time.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [origin, href, attempt]);

	useEffect(() => {
		host.current?.pushAccounts(account() ? [account()!] : []);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [wallet.address]);

	// A frame can time a connect to land under a tap it invited, so Connect ignores taps at first.
	useEffect(() => {
		setApprovalArmed(false);
		if (!approval) return;
		const timer = setTimeout(() => setApprovalArmed(true), 600);
		return () => clearTimeout(timer);
	}, [approval]);

	useEffect(() => {
		if (!choosing) settleConnect(false);
	}, [choosing]);

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	return (
		<>
			<div className="fixed inset-0 z-50 flex flex-col bg-background">
				<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3 pt-[env(safe-area-inset-top)]">
					<Button
						variant="ghost"
						size="icon"
						aria-label="Close"
						onClick={onClose}
						className="bg-muted/70 hover:bg-muted"
					>
						<X className="size-5" />
					</Button>
					<div className="min-w-0 flex-1">
						<p className="truncate text-[15px] font-semibold">{label}</p>
						<p className="truncate text-[12px] text-muted-foreground">{hostname}</p>
					</div>
					{!wallet.ready ? (
						<Skeleton className="h-7 w-24 shrink-0 rounded-full" />
					) : wallet.address ? (
						<button
							type="button"
							aria-label={copied ? 'Copied' : 'Copy wallet address'}
							onClick={() => {
								const address = wallet.address;
								if (!address) return;
								void copyText(address, 'Wallet address copied').then((ok) => {
									if (ok) setCopied(true);
								});
							}}
							className="inline-flex h-11 max-w-28 shrink-0 items-center rounded-full px-2 text-[12px] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
						>
							<span className="truncate">{copied ? 'Copied' : shortAddress(wallet.address)}</span>
						</button>
					) : (
						<Button
							size="sm"
							className="shrink-0 rounded-full px-4"
							onClick={() => setChoosing(true)}
						>
							Connect
						</Button>
					)}
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="New tab"
						className={buttonVariants({ variant: 'quiet', size: 'icon' })}
					>
						<SquareArrowOutUpRight />
					</a>
				</header>
				{origin && slow ? (
					<div
						className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-muted/60 px-4 py-2.5"
						role="status"
					>
						<p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
							This is taking longer than usual.
						</p>
						<Button
							size="sm"
							variant="secondary"
							className="shrink-0 rounded-full"
							onClick={() => setAttempt((n) => n + 1)}
						>
							Reload
						</Button>
					</div>
				) : null}
				{origin ? (
					<div className="relative flex min-h-0 flex-1 flex-col">
						<iframe
							ref={frame}
							title={label}
							sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
							allow={`publickey-credentials-get ${origin}; clipboard-write ${origin}`}
							referrerPolicy="origin"
							className={`min-h-0 w-full flex-1 border-0 bg-background ${approval ? 'pointer-events-none' : ''}`}
						/>
						<div
							aria-hidden={loaded}
							className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background transition-opacity duration-300 ${loaded ? 'opacity-0' : 'opacity-100'}`}
						>
							<Spinner className="size-6 text-muted-foreground" />
							<p className="text-[13px] text-muted-foreground" role="status">
								Loading {hostname || label}…
							</p>
						</div>
					</div>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
						<p className="text-[15px] font-medium">This app can’t open here</p>
						<Button href={href} target="_blank" rel="noopener noreferrer" variant="secondary">
							Open in new tab
						</Button>
					</div>
				)}
			</div>
			<WalletConnect
				open={choosing}
				onOpenChange={setChoosing}
				showButton={false}
				onConnected={() => settleConnect(true)}
				onDismissed={() => settleConnect(false)}
			/>
			{approval ? (
				<div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
					<div
						className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-lg"
						role="dialog"
						aria-modal="true"
					>
						<h2 className="text-[17px] font-semibold">Connect to {hostname || label}?</h2>
						<p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
							It will see {wallet.address ? shortAddress(wallet.address) : 'your wallet'}. You still
							approve every transaction.
						</p>
						<div className="mt-5 grid gap-2">
							<Button
								size="xl"
								disabled={!approvalArmed}
								onClick={() => {
									approval.accept(true);
									setApproval(null);
								}}
							>
								Connect
							</Button>
							<Button
								variant="quiet"
								size="xl"
								onClick={() => {
									approval.accept(false);
									setApproval(null);
								}}
							>
								Cancel
							</Button>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
