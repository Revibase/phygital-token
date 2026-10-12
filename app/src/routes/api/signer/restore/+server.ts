import { restoreBlob, signerRoute } from '$lib/server/signer/backup';

export const POST = signerRoute((env, body) => restoreBlob(env, body));
