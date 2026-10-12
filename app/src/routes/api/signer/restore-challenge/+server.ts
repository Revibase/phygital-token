import { issueRestoreChallenge, signerRoute } from '$lib/server/signer/backup';

export const POST = signerRoute((env) => issueRestoreChallenge(env.db));
