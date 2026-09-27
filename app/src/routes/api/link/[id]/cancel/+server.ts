import { cancelLink } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const POST = linkRoute(({ env, caller, event }) => cancelLink(env, caller, event.params.id!));
