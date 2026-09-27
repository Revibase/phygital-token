import type { Rpc, SolanaRpcApi } from '@solana/kit';

import type { TapFailureReason } from '$lib/shared/types';
import { resolveAccessoryByIdentifier, type ResolvedAccessory } from '../accessory/resolve';
import { consumeTapCounter } from './counter-store';
import { TapParamError, verifyDynamicUrlWithoutCounterCheck } from './verify-dynamic-url';

export const TAP_PARAMS = ['pk', 'c', 'n', 's'] as const;

export type TapOutcome =
	| { ok: true; identifier: string; counter: number; accessory: ResolvedAccessory }
	| { ok: false; reason: TapFailureReason; identifier?: string; detail?: string };

export function hasTapParams(params: URLSearchParams): boolean {
	return TAP_PARAMS.some((k) => params.has(k));
}

/**
 * The NFC tap ceremony:
 * parse → verify P-256 → consume counter (shared high-water mark) → resolve token.
 *
 * Order matters: the counter is consumed only after the signature verifies,
 * so garbage URLs can't burn a chip's counter; and it is consumed before the
 * RPC lookup, so a replayed URL is rejected even when the RPC is down.
 */
export async function handleTap(
	deps: { tapDb: D1Database; appDb: D1Database; rpc: Rpc<SolanaRpcApi> },
	params: URLSearchParams
): Promise<TapOutcome> {
	let verified;
	try {
		verified = verifyDynamicUrlWithoutCounterCheck(params);
	} catch (err) {
		return { ok: false, reason: 'malformed', detail: err instanceof TapParamError ? err.message : undefined };
	}
	if (!verified.isVerified) {
		return { ok: false, reason: 'invalid', identifier: verified.identifier };
	}

	let verdict;
	try {
		verdict = await consumeTapCounter(deps.tapDb, verified.identifier, verified.counter);
	} catch {
		return { ok: false, reason: 'network', identifier: verified.identifier, detail: 'counter store unavailable' };
	}
	if (verdict === 'replay') {
		return { ok: false, reason: 'replayed', identifier: verified.identifier };
	}

	let accessory: ResolvedAccessory | null;
	try {
		accessory = await resolveAccessoryByIdentifier(deps.appDb, deps.rpc, verified.identifier);
	} catch {
		return { ok: false, reason: 'network', identifier: verified.identifier, detail: 'rpc unavailable' };
	}
	if (!accessory) {
		return { ok: false, reason: 'unknown', identifier: verified.identifier };
	}

	return { ok: true, identifier: verified.identifier, counter: verified.counter, accessory };
}
