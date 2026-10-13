import type { ProgramIdl } from '../program-idl';

/**
 * The editor's descriptions of the native programs: `native.json`, parsed from the
 * pinned official IDLs beside it (a test keeps it in step), so the editor downloads a
 * few KB instead of the full snapshots. Shared across editor mounts; a failed load retries.
 */
let cached: Promise<Record<string, ProgramIdl>> | undefined;
export function nativeProgramIdls(): Promise<Record<string, ProgramIdl>> {
	return (cached ??= import('./native.json')
		.then((module) => module.default as Record<string, ProgramIdl>)
		.catch((error) => {
			cached = undefined;
			throw error;
		}));
}
