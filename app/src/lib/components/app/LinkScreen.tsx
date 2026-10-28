'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { linkCopy } from '#lib/client/accessory/link-copy.ts';
import { useBoot } from '#lib/client/boot';
import { canTapHere, platform, tapHint } from '#lib/client/capability.ts';
import {
	actionFailure,
	describeError,
	linkErrorCopy,
	type FriendlyError
} from '#lib/client/link/messages.ts';
import {
	finishLink,
	prepareTap,
	tapAccessory,
	type FinishPhase,
	type PreparedTap,
	type TappedAccessory
} from '#lib/client/link/flow.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { Button } from '#lib/components/ui/button';
import { Spinner } from '#lib/components/ui/spinner';
import { shortAddress } from '#lib/shared/encoding.ts';
import { explorerUrl } from '#lib/shared/explorer.ts';
import type { AccessoryView } from '#lib/shared/types.ts';
import { AccessoryMark } from './AccessoryMark';
import { BondVisual } from './BondVisual';
import { Countdown } from './Countdown';
import { List } from './List';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';
import { QrCode } from './QrCode';
import { WalletConnect } from './WalletConnect';
import { WalletRow } from './WalletRow';

const STALE_MS = 45_000;

export function LinkScreen({ accessory }: { accessory: AccessoryView }) {
	const wallet = useWallet();
	const { cluster } = useBoot();
	const router = useRouter();
	const copy = linkCopy(accessory.kind);
	const [prepared, setPrepared] = useState<PreparedTap | null>(null);
	const [tapped, setTapped] = useState<TappedAccessory | null>(null);
	const [linked, setLinked] = useState<{ recipient: string; signature: string } | null>(null);
	const [tapping, setTapping] = useState(false);
	const [failure, setFailure] = useState<FriendlyError | null>(null);
	const [phase, setPhase] = useState<FinishPhase | null>(null);
	const [hint, setHint] = useState('Tap Approve, then hold your accessory to your phone.');
	const [webauthnOk, setWebauthnOk] = useState(true);
	const [device, setDevice] = useState<'pending' | 'desktop' | 'mobile'>('pending');
	const [origin, setOrigin] = useState('');
	const [retry, setRetry] = useState(0);
	const prepareFailures = useRef(0);
	const challengeEpoch = useRef(0);
	const tappedRef = useRef(tapped);
	const tappingRef = useRef(tapping);
	tappedRef.current = tapped;
	tappingRef.current = tapping;

	const view = (() => {
		if (device === 'desktop') return 'phone' as const;
		if (linked) return 'done' as const;
		if (device === 'pending') return 'pending' as const;
		if (!wallet.address) return 'choose' as const;
		if (!tapped) return 'tap' as const;
		return 'confirm' as const;
	})();
	const ownedResult = !!linked && wallet.address === linked.recipient;

	useEffect(() => {
		setOrigin(window.location.origin);
		if (platform() === 'desktop') {
			setDevice('desktop');
			return;
		}
		setDevice('mobile');
		const nextHint = tapHint();
		setHint(`Tap Approve, then ${nextHint.charAt(0).toLowerCase()}${nextHint.slice(1)}`);
		setWebauthnOk(canTapHere());
	}, []);

	useEffect(() => {
		if (tapping || phase || linked) return;
		const recipient = wallet.address;
		let staleTimer: ReturnType<typeof setTimeout> | undefined;
		const epoch = ++challengeEpoch.current;
		setTapped(null);
		setPrepared(null);
		if (!recipient) return;
		let cancelled = false;
		async function refresh() {
			if (!recipient || tappedRef.current || tappingRef.current) return;
			try {
				const next = await prepareTap(accessory.publicKey, recipient);
				if (cancelled || epoch !== challengeEpoch.current || tappedRef.current) return;
				setPrepared(next);
				prepareFailures.current = 0;
				staleTimer = setTimeout(() => void refresh(), STALE_MS);
			} catch (err) {
				if (!cancelled && epoch === challengeEpoch.current && ++prepareFailures.current >= 2)
					setFailure(describeError(err));
			}
		}
		void refresh();
		return () => {
			cancelled = true;
			clearTimeout(staleTimer);
		};
	}, [wallet.address, accessory.publicKey, phase, linked, retry]);

	function tapExpired() {
		if (phase || linked) return;
		setTapped(null);
		setFailure(linkErrorCopy('too_slow'));
	}

	async function tap() {
		if (!prepared) return;
		setTapping(true);
		setFailure(null);
		const challenge = prepared;
		setPrepared(null);
		let ok = false;
		try {
			setTapped(await tapAccessory(challenge));
			ok = true;
		} catch (err) {
			setFailure(describeError(err, 'tap'));
		} finally {
			setTapping(false);
			if (!ok) setRetry((current) => current + 1);
		}
	}

	async function approveHere() {
		if (!tapped) return;
		const context = wallet.signingContext();
		setFailure(null);
		try {
			const signature = await finishLink(tapped, context, setPhase);
			setLinked({ recipient: context.address, signature });
		} catch (err) {
			setFailure(actionFailure(err));
		} finally {
			setPhase(null);
		}
	}

	return (
		<PageShell
			brand={false}
			connect={false}
			footer={
				<div className="grid gap-1">
					<WalletConnect showButton={view === 'choose'} />
					{view === 'done' && linked ? (
						<>
							<Button href="/accessory" size="xl" className="w-full">
								Done
							</Button>
							<Button
								variant="quiet"
								className="w-full"
								href={explorerUrl('tx', linked.signature, cluster)}
								target="_blank"
								rel="noopener noreferrer"
							>
								View transaction
							</Button>
						</>
					) : view === 'tap' && webauthnOk ? (
						<Button
							size="xl"
							className="w-full"
							disabled={tapping || !prepared}
							onClick={() => void tap()}
						>
							{tapping ? (
								<>
									<Spinner /> Hold your accessory to your phone…
								</>
							) : !prepared ? (
								<>
									<Spinner /> Preparing…
								</>
							) : (
								'Approve'
							)}
						</Button>
					) : view === 'confirm' && wallet.address ? (
						<Button
							size="xl"
							className="w-full"
							disabled={!!phase}
							onClick={() => void approveHere()}
						>
							{phase === 'approve' ? (
								<>
									<Spinner /> {wallet.approvePrompt}
								</>
							) : phase === 'confirming' ? (
								<>
									<Spinner /> Confirming…
								</>
							) : phase ? (
								<>
									<Spinner /> Preparing…
								</>
							) : (
								copy.action
							)}
						</Button>
					) : null}
					{view !== 'done' ? (
						<Button
							variant="quiet"
							className="w-full"
							disabled={!!phase}
							onClick={() => router.push('/accessory')}
						>
							Cancel
						</Button>
					) : null}
				</div>
			}
		>
			<section className="flex flex-1 flex-col pt-4" aria-live="polite">
				<div className="animate-rise flex flex-1 flex-col gap-7">
					{view === 'phone' ? (
						<div className="flex flex-1 flex-col justify-center gap-8">
							<PageHeader
								align="center"
								title="Claim on your phone"
								body="Claiming uses your phone’s NFC."
							/>
							{origin ? <QrCode value={origin} label="Scan with your phone’s camera" /> : null}
						</div>
					) : view === 'pending' ? (
						<div className="flex-1" />
					) : view === 'done' && linked ? (
						<div className="flex flex-1 flex-col justify-center gap-8">
							<BondVisual
								wallet={linked.recipient}
								pda={accessory.pda}
								hasMint={!!accessory.mint}
							/>
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
					) : (
						<>
							{view === 'choose' ? (
								<PageHeader
									step={{ current: 1, total: 3 }}
									title={copy.choose.title}
									body={copy.choose.body}
								/>
							) : view === 'tap' ? (
								<PageHeader
									step={{ current: 2, total: 3 }}
									title="Approve with your accessory"
									body={hint}
								/>
							) : (
								<PageHeader
									step={{ current: 3, total: 3 }}
									title={copy.confirm.title}
									body={accessory.mint ? `${copy.confirm.body} ${copy.nft}` : copy.confirm.body}
								/>
							)}
							<Notice error={failure} />
							{view === 'choose' || view === 'tap' ? (
								<div className="grid flex-1 place-items-center py-6">
									<AccessoryMark
										state={tapping ? 'waiting' : 'idle'}
										pda={accessory.pda}
										hasMint={!!accessory.mint}
									/>
								</div>
							) : null}
							{view === 'tap' && wallet.address ? (
								<List>
									<WalletRow address={wallet.address} label="Your wallet" />
								</List>
							) : null}
							{view === 'tap' && !webauthnOk ? (
								<Notice
									title="Open this page in Safari or Chrome"
									body="This browser can’t read your accessory."
								/>
							) : null}
							{view === 'confirm' && wallet.address ? (
								<List>
									<WalletRow address={wallet.address} label="Your wallet" />
								</List>
							) : null}
							{tapped && (view === 'choose' || view === 'confirm') ? (
								<Countdown until={tapped.expiresAt} onExpire={tapExpired} />
							) : null}
						</>
					)}
				</div>
			</section>
		</PageShell>
	);
}
