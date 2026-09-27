import { startPhoneLink } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const POST = linkRoute(({ env, caller }) => startPhoneLink(env, caller));
