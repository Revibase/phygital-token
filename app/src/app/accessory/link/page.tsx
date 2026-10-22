import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { LinkScreen } from '#lib/components/app/LinkScreen';
import { toAccessoryView } from '#lib/shared/accessory-view.ts';
import { fetchAccessory } from '#lib/server/accessory/resolve.ts';
import { getEnv, getRpc } from '#lib/server/env.ts';
import { ADMIT_PDA_HEADER } from '#lib/server/session/cookies.ts';

export const dynamic = 'force-dynamic';

/** Middleware already required browse_unlock. This page only checks the token can still be claimed. */
export default async function Page() {
	const pda = (await headers()).get(ADMIT_PDA_HEADER);
	if (!pda) redirect('/tap/expired');
	const env = await getEnv();
	const resolved = await fetchAccessory(getRpc(env), pda).catch(() => null);
	if (!resolved) redirect('/accessory');
	const accessory = toAccessoryView(resolved.pda, resolved.account);
	if (!accessory.canLink) redirect('/accessory');
	return <LinkScreen accessory={accessory} />;
}
