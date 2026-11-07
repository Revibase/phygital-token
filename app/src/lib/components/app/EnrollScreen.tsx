'use client';

import { useRouter } from 'next/navigation';
import { enrollCard } from 'phygital-token-sdk';
import { useEffect, useState } from 'react';

import { ApiClientError, postJson } from '#lib/client/api.ts';
import { TAP_HINT, tapPrompt, webauthnAvailable } from '#lib/client/capability.ts';
import { describeError, ENROLL_COPY, type FriendlyError } from '#lib/client/link/messages.ts';
import { Button } from '#lib/components/ui/button';
import { Spinner } from '#lib/components/ui/spinner';
import { base64UrlToBytes } from '#lib/shared/encoding.ts';
import { AccessoryMark } from './AccessoryMark';
import { CLAIM_STEPS } from './LinkScreen';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';

const BUSY = {
	card: { body: TAP_HINT, pending: 'Hold your accessory to your phone…' },
	saving: { body: ENROLL_COPY.saving, pending: 'Setting up…' }
};

/**
 * Set up a card that has no token yet: step 1 of claiming it. One
 * `credentials.create` tap over the enroll session's `challenge` (base64url)
 * enrolls its product key, the server registers it, and the claim continues on
 * `/accessory/link`. Enrolling is idempotent on the card, so a failed attempt
 * is retried with another tap over the same challenge.
 */
export function EnrollScreen({ challenge }: { challenge: string }) {
	const router = useRouter();
	const [phase, setPhase] = useState<'idle' | 'card' | 'saving'>('idle');
	const [failure, setFailure] = useState<FriendlyError | null>(null);
	const [supported, setSupported] = useState<boolean | null>(null);
	// The enroll session ran out: only a new tap of the accessory helps.
	const [expired, setExpired] = useState(false);

	useEffect(() => setSupported(webauthnAvailable()), []);

	async function enroll() {
		if (phase !== 'idle') return;
		setFailure(null);
		setPhase('card');
		try {
			const response = await enrollCard(base64UrlToBytes(challenge));
			setPhase('saving');
			await postJson<{ pda: string }>('/api/enroll', { response });
			router.replace('/accessory/link?setup=1');
		} catch (err) {
			if (err instanceof ApiClientError && err.code === 'expired') setExpired(true);
			setFailure(describeError(err, 'tap'));
			setPhase('idle');
		}
	}

	const busy = phase === 'idle' ? null : BUSY[phase];
	const body =
		supported === null
			? ENROLL_COPY.body
			: busy
				? busy.body
				: supported
					? `${ENROLL_COPY.body} ${tapPrompt(ENROLL_COPY.action)}`
					: ENROLL_COPY.unsupported;
	const pending = busy?.pending ?? null;

	return (
		<PageShell brand={false} connect={false}>
			<section className="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
				<PageHeader
					step={{ current: 1, total: 1 + CLAIM_STEPS }}
					title={ENROLL_COPY.title}
					body={body}
				/>
				<Notice error={failure} />
				<div className="grid flex-1 place-items-center py-6">
					<AccessoryMark state={phase === 'idle' ? 'idle' : 'waiting'} />
				</div>
			</section>
			<footer className="pt-6">
				<div className="grid gap-1">
					{supported !== false && !expired ? (
						<Button size="xl" disabled={!!pending} onClick={() => void enroll()}>
							{pending ? (
								<>
									<Spinner /> {pending}
								</>
							) : failure ? (
								ENROLL_COPY.retry
							) : (
								ENROLL_COPY.action
							)}
						</Button>
					) : null}
					<Button href="/" variant="quiet" className="w-full" disabled={phase !== 'idle'}>
						Not now
					</Button>
				</div>
			</footer>
		</PageShell>
	);
}
