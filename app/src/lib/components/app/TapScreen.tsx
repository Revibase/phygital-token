'use client';

import { useRouter } from 'next/navigation';
import { startAuthentication } from 'phygital-token-sdk';
import { useEffect, useState } from 'react';

import { postJson } from '#lib/client/api.ts';
import { tapPrompt, webauthnAvailable } from '#lib/client/capability.ts';
import { describeError, TAP_FAILURE_COPY, type FriendlyError } from '#lib/client/link/messages.ts';
import { Button } from '#lib/components/ui/button';
import { Spinner } from '#lib/components/ui/spinner';
import type { TapFailureReason } from '#lib/shared/types.ts';
import { AccessoryMark } from './AccessoryMark';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';

export function TapScreen({ reason }: { reason: TapFailureReason }) {
	const router = useRouter();
	const copy = TAP_FAILURE_COPY[reason];
	const retryable = reason !== 'unknown';
	const resumable = reason === 'expired';
	const unverified = reason === 'unknown' || reason === 'invalid';
	const [challenge, setChallenge] = useState<{
		challengeId: string;
		message: string;
		at: number;
	} | null>(null);
	const [tapping, setTapping] = useState(false);
	const [failure, setFailure] = useState<FriendlyError | null>(null);
	// null until checked after mount.
	const [webauthnOk, setWebauthnOk] = useState<boolean | null>(null);
	const body =
		!resumable || webauthnOk === null
			? copy.body
			: webauthnOk
				? tapPrompt('Continue')
				: 'Hold your accessory to your phone again.';

	async function prepare() {
		try {
			const next = await postJson<{ challengeId: string; message: string }>('/api/tap/challenge');
			setChallenge({ ...next, at: Date.now() });
		} catch (err) {
			setFailure(describeError(err));
		}
	}

	useEffect(() => {
		if (!resumable) return;
		const ok = webauthnAvailable();
		setWebauthnOk(ok);
		if (ok) void prepare();
		const refresher = setInterval(() => {
			setChallenge((current) => {
				if (ok && !tapping && (!current || Date.now() - current.at > 90_000)) void prepare();
				return current;
			});
		}, 15_000);
		return () => clearInterval(refresher);
		// prepare is stable enough for this screen's lifetime
	}, [resumable]);

	async function resume() {
		if (!challenge) return;
		const current = challenge;
		setChallenge(null);
		setTapping(true);
		setFailure(null);
		try {
			const response = await startAuthentication(current.message);
			const { next } = await postJson<{ next: string }>('/api/tap/resume', {
				challengeId: current.challengeId,
				response
			});
			router.replace(next);
		} catch (err) {
			setFailure(describeError(err, 'tap'));
			void prepare();
		} finally {
			setTapping(false);
		}
	}

	return (
		<PageShell brand={false} connect={false}>
			<section
				className="flex flex-1 flex-col items-center justify-center gap-8 pb-8"
				role={reason === 'expired' ? undefined : 'alert'}
				aria-live="polite"
			>
				<AccessoryMark
					state={
						unverified ? 'unverified' : retryable && (!resumable || tapping) ? 'waiting' : 'idle'
					}
				/>
				<PageHeader align="center" title={copy.title} body={body} />
				{failure ? (
					<div className="w-full">
						<Notice error={failure} />
					</div>
				) : null}
			</section>
			<footer className="pt-6">
				<div className="grid gap-1">
					{resumable && webauthnOk !== false ? (
						<Button size="xl" disabled={tapping || !challenge} onClick={() => void resume()}>
							{tapping ? (
								<>
									<Spinner /> Hold your accessory to your phone…
								</>
							) : !challenge ? (
								<>
									<Spinner /> Preparing…
								</>
							) : (
								'Continue'
							)}
						</Button>
					) : null}
					<Button href="/" variant="quiet" className="w-full">
						Your accessories
					</Button>
				</div>
			</footer>
		</PageShell>
	);
}
