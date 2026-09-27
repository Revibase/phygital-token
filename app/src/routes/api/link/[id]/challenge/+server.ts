import { issueChallenge } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const POST = linkRoute(({ env, caller, event }) => issueChallenge(env, caller, event.params.id!));
