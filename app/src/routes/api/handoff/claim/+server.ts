import { claimHandoff } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const POST = linkRoute(({ env, body, event }) => claimHandoff(env, event.cookies, body));
