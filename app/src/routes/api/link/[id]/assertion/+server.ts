import { acceptAssertion } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const POST = linkRoute(({ env, caller, body, event }) => acceptAssertion(env, caller, event.params.id!, body));
