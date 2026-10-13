import { startDesktopPairing } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const POST = linkRoute(({ env, event }) => startDesktopPairing(env, event.cookies));
