import { issueBackupChallenge, signerRoute } from '$lib/server/signer/backup';

export const POST = signerRoute((env) => issueBackupChallenge(env.db));
