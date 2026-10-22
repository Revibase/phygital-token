import { notFound } from 'next/navigation';

import { TAP_FAILURE_COPY } from '#lib/client/link/messages.ts';
import { TapScreen } from '#lib/components/app/TapScreen';
import type { TapFailureReason } from '#lib/shared/types.ts';

export default async function Page({ params }: { params: Promise<{ reason: string }> }) {
	const { reason } = await params;
	if (!(reason in TAP_FAILURE_COPY)) notFound();
	return <TapScreen reason={reason as TapFailureReason} />;
}
