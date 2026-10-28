import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AccessoryScreen } from '#lib/components/app/AccessoryScreen';
import { toAccessoryView } from '#lib/shared/accessory-view.ts';
import { fetchAccessory } from '#lib/server/accessory/resolve.ts';
import { getEnv, getRpc } from '#lib/server/env.ts';
import { ADMIT_PDA_HEADER } from '#lib/server/session/cookies.ts';

export const dynamic = 'force-dynamic';

export default async function Page() {
	const pda = (await headers()).get(ADMIT_PDA_HEADER);
	if (!pda) redirect('/tap/expired');

	const env = await getEnv();
	try {
		const resolved = await fetchAccessory(getRpc(env), pda);
		if (!resolved) redirect('/tap/unknown');
		return (
			<AccessoryScreen
				accessory={toAccessoryView(resolved.pda, resolved.account)}
				loadError={false}
			/>
		);
	} catch (err) {
		if (err && typeof err === 'object' && 'digest' in err) throw err;
		return <AccessoryScreen accessory={null} loadError />;
	}
}
