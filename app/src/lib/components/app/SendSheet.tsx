'use client';

import { address as toAddress, type Address } from '@solana/kit';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

import { actionFailure, describeError, type FriendlyError } from '#lib/client/link/messages.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { planTransfer, sendTransfer, type TransferPlan } from '#lib/client/wallet/send.ts';
import { Button } from '#lib/components/ui/button';
import { Input } from '#lib/components/ui/input';
import { Spinner } from '#lib/components/ui/spinner';
import {
	formatCompactTokenAmount,
	formatTokenAmount,
	sanitizeDecimalInput,
	SOL_DECIMALS,
	uiAmountToRaw
} from '#lib/shared/amount.ts';
import { explorerUrl } from '#lib/shared/explorer.ts';
import { shortAddress } from '#lib/shared/encoding.ts';
import { tokenLabel, type WalletHoldings } from '#lib/shared/wallet-holdings.ts';
import { maxSendable, transferFeeLamports, type SendAsset } from '#lib/shared/wallet-transfer.ts';
import { Field } from './Field';
import { FieldError } from './FieldError';
import { HoldingsList } from './HoldingsList';
import { Notice } from './Notice';
import { Panel } from './Panel';
import { ResponsiveSheet } from './ResponsiveSheet';
import { TokenIcon } from './TokenIcon';

export function SendSheet({
	open,
	onOpenChange,
	holdings,
	asset,
	cluster
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	holdings: WalletHoldings | undefined;
	asset: SendAsset | null;
	cluster: string;
}) {
	const wallet = useWallet();
	const uid = useId();
	const sol = (lamports: bigint) => `${formatCompactTokenAmount(lamports, SOL_DECIMALS)} SOL`;
	const [chosen, setChosen] = useState<SendAsset | null>(asset);
	const [recipient, setRecipient] = useState('');
	const [amount, setAmount] = useState('');
	const [plan, setPlan] = useState<TransferPlan | null>(null);
	const [busy, setBusy] = useState<'review' | 'send' | null>(null);
	const [failure, setFailure] = useState<FriendlyError | null>(null);

	useEffect(() => {
		if (open) setChosen(asset);
	}, [open, asset]);
	useEffect(() => {
		if (!open) {
			setRecipient('');
			setAmount('');
			setPlan(null);
			setFailure(null);
		}
	}, [open]);
	useEffect(() => {
		setPlan(null);
	}, [recipient, amount]);

	const current: SendAsset = chosen ?? { kind: 'sol' };
	const label = current.kind === 'sol' ? 'SOL' : tokenLabel(current.token);
	const decimals = current.kind === 'sol' ? SOL_DECIMALS : current.token.decimals;
	const balance = current.kind === 'sol' ? (holdings?.lamports ?? 0n) : current.token.amount;
	const icon = current.kind === 'sol' ? '/solana.svg' : current.token.icon;

	function choose(next: SendAsset | null) {
		setChosen(next);
		setAmount('');
		setPlan(null);
		setFailure(null);
	}

	let validRecipient: Address | null = null;
	try {
		if (recipient.trim()) validRecipient = toAddress(recipient.trim());
	} catch {
		validRecipient = null;
	}
	let raw: bigint | null = null;
	let rawError: string | null = null;
	if (amount) {
		try {
			raw = uiAmountToRaw(amount, decimals);
		} catch (err) {
			rawError = (err as Error).message;
		}
	}
	const formProblem =
		recipient.trim() && !validRecipient
			? 'Enter a valid Solana address.'
			: rawError
				? rawError
				: raw !== null && raw > balance
					? 'That’s more than this wallet holds.'
					: null;
	const ready = !!validRecipient && raw !== null && !formProblem;

	function setMax() {
		if (!holdings) return;
		setAmount(formatTokenAmount(maxSendable(holdings, current, false), decimals));
	}

	async function review() {
		if (!holdings || !validRecipient || raw === null) return;
		setBusy('review');
		setFailure(null);
		try {
			setPlan(await planTransfer(wallet.signingContext(), holdings, current, validRecipient, raw));
		} catch (err) {
			setFailure(describeError(err));
		} finally {
			setBusy(null);
		}
	}

	async function send() {
		if (!plan || plan.problem) return;
		setBusy('send');
		setFailure(null);
		try {
			const signature = await sendTransfer(wallet.signingContext(), plan);
			toast.success(`Sent ${amount} ${label}`, {
				description: `To ${shortAddress(plan.request.recipient)}`,
				action: {
					label: 'View',
					onClick: () => window.open(explorerUrl('tx', signature, cluster), '_blank', 'noopener')
				}
			});
			onOpenChange(false);
		} catch (err) {
			setFailure(actionFailure(err));
		} finally {
			setBusy(null);
		}
	}

	return (
		<ResponsiveSheet
			open={open}
			onOpenChange={onOpenChange}
			title={chosen ? `Send ${label}` : 'Send'}
			description={chosen ? undefined : 'Choose what to send.'}
		>
			{!chosen ? (
				<HoldingsList holdings={holdings} label={null} onSelect={choose} />
			) : (
				<>
					<Notice error={failure} />
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void (plan && !plan.problem ? send() : review());
						}}
					>
						<Panel className="flex items-center gap-3 py-4">
							<TokenIcon src={icon} label={label} />
							<div className="min-w-0 flex-1">
								<p className="truncate text-[15px] font-medium">{label}</p>
								<p className="text-[13px] text-muted-foreground">
									{formatCompactTokenAmount(balance, decimals)} available
								</p>
							</div>
							{asset === null ? (
								<Button
									variant="ghost"
									size="sm"
									className="text-primary"
									disabled={!!busy}
									onClick={() => choose(null)}
								>
									Change
								</Button>
							) : null}
						</Panel>
						<Field label="Send to" id={`${uid}-recipient`}>
							<Input
								id={`${uid}-recipient`}
								value={recipient}
								disabled={!!busy}
								placeholder="Solana address"
								autoComplete="off"
								autoCapitalize="off"
								spellCheck={false}
								onChange={(event) => setRecipient(event.target.value)}
							/>
						</Field>
						<Field
							label="Amount"
							id={`${uid}-amount`}
							labelAction={
								<Button
									variant="ghost"
									size="sm"
									className="-my-3 text-primary"
									disabled={!!busy || !holdings}
									onClick={setMax}
								>
									Max
								</Button>
							}
						>
							<Input
								id={`${uid}-amount`}
								value={amount}
								disabled={!!busy}
								inputMode="decimal"
								placeholder="0.00"
								aria-invalid={!!formProblem || !!plan?.problem || undefined}
								onChange={(event) => setAmount(sanitizeDecimalInput(event.target.value))}
							/>
						</Field>
						<FieldError message={formProblem ?? plan?.problem} />
						{plan && !plan.problem ? (
							<Panel className="space-y-2 py-4 text-[14px]">
								<div className="flex justify-between gap-3">
									<span className="text-muted-foreground">To</span>
									<span className="font-mono text-[13px]">
										{shortAddress(plan.request.recipient)}
									</span>
								</div>
								<div className="flex justify-between gap-3">
									<span className="text-muted-foreground">Amount</span>
									<span>
										{amount} {label}
									</span>
								</div>
								{plan.cost.accountRent ? (
									<div className="flex justify-between gap-3">
										<span className="text-muted-foreground">Recipient’s token account</span>
										<span>{sol(plan.cost.accountRent)}</span>
									</div>
								) : null}
								<div className="flex justify-between gap-3">
									<span className="text-muted-foreground">Network fee</span>
									<span>{sol(plan.cost.fee)}</span>
								</div>
								<div className="flex justify-between gap-3 border-t pt-2 font-medium">
									<span>Total from this wallet</span>
									<span>
										{current.kind === 'sol'
											? sol(plan.cost.solOut)
											: `${amount} ${label} + ${sol(plan.cost.solOut)}`}
									</span>
								</div>
							</Panel>
						) : (
							<p className="text-[13px] text-muted-foreground">
								Network fee about {sol(transferFeeLamports())}.
							</p>
						)}
						<Button type="submit" size="xl" disabled={!ready || !!busy || !!plan?.problem}>
							{busy === 'send' ? (
								<>
									<Spinner /> {wallet.approvePrompt}
								</>
							) : busy === 'review' ? (
								<>
									<Spinner /> Checking…
								</>
							) : plan && !plan.problem ? (
								`Send ${amount} ${label}`
							) : (
								'Review'
							)}
						</Button>
					</form>
				</>
			)}
		</ResponsiveSheet>
	);
}
