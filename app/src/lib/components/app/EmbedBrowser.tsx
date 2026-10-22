'use client';

import { getBase58Encoder, getBase64EncodedWireTransaction, getTransactionDecoder } from '@solana/kit';
import { useEffect, useRef, useState } from 'react';

import { browserRpc } from '#lib/client/rpc.ts';
import { startEmbedHost, type EmbedAccount, type EmbedHost } from '#lib/client/wallet/embed-host.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { signWithWallet, type SigningContext } from '#lib/client/wallet/wallet.ts';
import { Button } from '#lib/components/ui/button';
import { shortAddress } from '#lib/shared/encoding.ts';
import { embedFrameOrigin } from '#lib/shared/wallet-bridge.ts';
import { WalletConnect } from './WalletConnect';

export function EmbedBrowser({ href, label, onClose }: { href: string; label: string; onClose: () => void }) {
	const wallet = useWallet();
	const frame = useRef<HTMLIFrameElement>(null);
	const host = useRef<EmbedHost | null>(null);
	const connectWaiter = useRef<((ok: boolean) => void) | null>(null);
	const [origin, setOrigin] = useState<string | null>(null);
	const [approval, setApproval] = useState<{ origin: string; accept: (ok: boolean) => void } | null>(null);
	const [choosing, setChoosing] = useState(false);
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

	function account(): EmbedAccount | null {
		try {
			const ctx = wallet.signingContext();
			return { address: ctx.address, publicKey: new Uint8Array(ctx.publicKey), chain: ctx.chain };
		} catch {
			return null;
		}
	}

	function requireAccount(chain: string): SigningContext {
		const ctx = wallet.signingContext();
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
			connect: () => {
				settleConnect(false);
				return new Promise<boolean>((resolve) => {
					connectWaiter.current = resolve;
					setChoosing(true);
				});
			},
			signer: {
				account,
				signTransaction: async (bytes, chain) => {
					const ctx = requireAccount(chain);
					if (!ctx.signTransaction) throw new Error('This wallet can’t return a signed transaction.');
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
	}, [origin, href]);

	useEffect(() => {
		host.current?.pushAccounts(account() ? [account()!] : []);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [wallet.address]);

	useEffect(() => {
		if (!choosing) settleConnect(false);
	}, [choosing]);

	return (
		<>
			<div className="fixed inset-0 z-50 flex flex-col bg-background">
				<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3 pt-[env(safe-area-inset-top)]">
					<Button variant="quiet" size="sm" onClick={onClose}>
						Back
					</Button>
					<div className="min-w-0 flex-1">
						<p className="truncate text-[15px] font-semibold">{label}</p>
						<p className="truncate text-[12px] text-muted-foreground">{hostname}</p>
					</div>
					{wallet.address ? (
						<p className="shrink-0 text-[12px] font-medium text-muted-foreground">{shortAddress(wallet.address)}</p>
					) : (
						<Button size="sm" className="shrink-0 rounded-full px-4" onClick={() => setChoosing(true)}>
							Connect
						</Button>
					)}
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						className="shrink-0 rounded-lg px-2 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
					>
						New tab
					</a>
				</header>
				{origin ? (
					<iframe
						ref={frame}
						title={label}
						sandbox="allow-scripts allow-same-origin allow-forms"
						referrerPolicy="no-referrer"
						className={`min-h-0 w-full flex-1 border-0 bg-background ${approval ? 'pointer-events-none' : ''}`}
					/>
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
					<div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-lg" role="dialog" aria-modal="true">
						<h2 className="text-[17px] font-semibold">Connect to {hostname || label}?</h2>
						<p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
							It will see {wallet.address ? shortAddress(wallet.address) : 'your wallet'}. You still approve every
							transaction.
						</p>
						<div className="mt-5 grid gap-2">
							<Button
								size="xl"
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
