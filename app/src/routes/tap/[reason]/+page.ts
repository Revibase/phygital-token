import { error } from '@sveltejs/kit';
import { TAP_FAILURE_COPY } from '$lib/client/link/messages';
import type { TapFailureReason } from '$lib/shared/types';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	if (!(params.reason in TAP_FAILURE_COPY)) error(404, 'Not found');
	return { reason: params.reason as TapFailureReason };
};
