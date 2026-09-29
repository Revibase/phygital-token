import { setRecipient } from '$lib/server/link/service';
import { linkRoute } from '$lib/server/link/route';

export const POST = linkRoute(({ env, caller, body, event }) => setRecipient(env, caller, event.params.id!, body));
