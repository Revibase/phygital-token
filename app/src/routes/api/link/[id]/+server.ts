import { linkStatus } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const GET = linkRoute(({ env, caller, event }) => linkStatus(env, caller, event.params.id!));
