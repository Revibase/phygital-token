import { claimPairing } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const POST = linkRoute(({ env, caller, body, event }) => claimPairing(env, event.cookies, caller, body));
