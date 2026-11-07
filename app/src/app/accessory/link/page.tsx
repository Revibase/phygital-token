import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { LinkScreen } from '#lib/components/app/LinkScreen';
import { toAccessoryView } from '#lib/shared/accessory-view.ts';
import { fetchAccessory, type ResolvedAccessory } from '#lib/server/accessory/resolve.ts';
import { getEnv, getRpc } from '#lib/server/env.ts';
import { ADMIT_PDA_HEADER } from '#lib/server/session/cookies.ts';

export const dynamic = 'force-dynamic';

/** Middleware already required browse_unlock. This page only checks the token can still be claimed. */
export default async function Page({
	searchParams
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const pda = (await headers()).get(ADMIT_PDA_HEADER);
	if (!pda) redirect('/tap/expired');
	// Arriving from /enroll: setup was step 1 of the claim.
	const afterSetup = (await searchParams).setup === '1';
	const env = await getEnv();
	const rpc = getRpc(env);
	let resolved: ResolvedAccessory | null = null;
	try {
		resolved = await fetchAccessory(rpc, pda);
		// Just confirmed by setup: give an RPC node that is a slot behind a moment to see it.
		for (let i = 0; afterSetup && !resolved && i < 3; i++) {
			await new Promise((r) => setTimeout(r, 750));
			resolved = await fetchAccessory(rpc, pda);
		}
	} catch {
		// An RPC error isn't lag; /accessory shows its retry screen.
	}
	if (!resolved) redirect('/accessory');
	const accessory = toAccessoryView(resolved.pda, resolved.account);
	if (!accessory.canLink) redirect('/accessory');
	return <LinkScreen accessory={accessory} afterSetup={afterSetup} />;
}
