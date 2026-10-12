import { putBlob, signerRoute } from '$lib/server/signer/backup';

export const PUT = signerRoute((env, body) => putBlob(env, body));
