import { type Address } from '@solana/kit';
import {
	identifyPhygitalTokenEvent,
	parseClosePhygitalTokenEventEvent,
	parseCreateConfigEventEvent,
	parseInitializeEventEvent,
	parseRemoveOwnerEventEvent,
	parseSetAdminEventEvent,
	parseSetIssuerEventEvent,
	parseSetOwnerEventEvent,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS,
	PhygitalTokenEvent,
	type ClosePhygitalTokenEventEvent,
	type CreateConfigEventEvent,
	type InitializeEventEvent,
	type RemoveOwnerEventEvent,
	type SetAdminEventEvent,
	type SetIssuerEventEvent,
	type SetOwnerEventEvent
} from 'phygital-token-sdk';

import { base64ToBytes } from '#lib/shared/encoding.ts';

export type ProgramEvent =
	| { name: 'InitializeEvent'; data: InitializeEventEvent }
	| { name: 'SetOwnerEvent'; data: SetOwnerEventEvent }
	| { name: 'RemoveOwnerEvent'; data: RemoveOwnerEventEvent }
	| { name: 'ClosePhygitalTokenEvent'; data: ClosePhygitalTokenEventEvent }
	| { name: 'CreateConfigEvent'; data: CreateConfigEventEvent }
	| { name: 'SetAdminEvent'; data: SetAdminEventEvent }
	| { name: 'SetIssuerEvent'; data: SetIssuerEventEvent }
	/**
	 * A discriminator this build doesn't know: an event added to the program later, or a
	 * retired one (`AssignMintEvent`, `SetMinterEvent`). Kept for the audit log.
	 */
	| { name: 'Unknown'; data: null };

export type LoggedEvent = ProgramEvent & {
	/** Position among this program's events in the transaction, in log order. */
	index: number;
	/** The event's bytes as logged (discriminator + Borsh), base64. */
	raw: string;
};

const PARSERS: Record<PhygitalTokenEvent, (bytes: Uint8Array) => unknown> = {
	[PhygitalTokenEvent.ClosePhygitalTokenEvent]: parseClosePhygitalTokenEventEvent,
	[PhygitalTokenEvent.CreateConfigEvent]: parseCreateConfigEventEvent,
	[PhygitalTokenEvent.InitializeEvent]: parseInitializeEventEvent,
	[PhygitalTokenEvent.RemoveOwnerEvent]: parseRemoveOwnerEventEvent,
	[PhygitalTokenEvent.SetAdminEvent]: parseSetAdminEventEvent,
	[PhygitalTokenEvent.SetIssuerEvent]: parseSetIssuerEventEvent,
	[PhygitalTokenEvent.SetOwnerEvent]: parseSetOwnerEventEvent
};

function decodeEvent(bytes: Uint8Array): ProgramEvent {
	let kind: PhygitalTokenEvent;
	try {
		kind = identifyPhygitalTokenEvent(bytes);
	} catch {
		return { name: 'Unknown', data: null };
	}
	return { name: PhygitalTokenEvent[kind], data: PARSERS[kind](bytes) } as ProgramEvent;
}

const INVOKE = /^Program (\w+) invoke \[\d+\]$/;
const EXIT = /^Program (\w+) (success|failed)/;
const DATA = 'Program data: ';

export class TruncatedLogsError extends Error {
	constructor() {
		super('The transaction logs were truncated, so some events may be missing.');
		this.name = 'TruncatedLogsError';
	}
}

/**
 * The events this program emitted (`emit!` → `sol_log_data`), in order.
 *
 * A `Program data:` line counts only while this program is the one running,
 * tracked from the runtime's `invoke` / `success` / `failed` lines. Any program
 * can log bytes that look like our events; only the runtime writes those lines,
 * and only the running program can log, so this attribution can't be forged.
 *
 * Throws `TruncatedLogsError` when the runtime cut the logs short: what's left
 * can't be trusted to be every event.
 */
export function decodeProgramEvents(
	logs: readonly string[],
	program: Address = PHYGITAL_TOKEN_PROGRAM_ADDRESS
): LoggedEvent[] {
	const stack: string[] = [];
	const events: LoggedEvent[] = [];
	for (const line of logs) {
		if (line === 'Log truncated') throw new TruncatedLogsError();
		const invoke = INVOKE.exec(line);
		if (invoke) {
			stack.push(invoke[1]);
			continue;
		}
		const exit = EXIT.exec(line);
		if (exit && stack.at(-1) === exit[1]) {
			stack.pop();
			continue;
		}
		if (line.startsWith(DATA) && stack.at(-1) === program) {
			// Anchor logs the whole event as one field.
			const raw = line.slice(DATA.length).trim();
			if (!raw || raw.includes(' ')) continue;
			const event = decodeEvent(base64ToBytes(raw));
			events.push({ ...event, index: events.length, raw });
		}
	}
	return events;
}
