import { NextResponse } from 'next/server';

import { getEnv } from '#lib/server/env.ts';
import { issueResumeChallenge } from '#lib/server/tap/resume.ts';

export async function POST() {
	const env = await getEnv();
	return NextResponse.json(await issueResumeChallenge(env.DB));
}
