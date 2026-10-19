import type { Shortcut } from '#lib/shared/shortcuts.ts';
import { getJson } from './api';

export async function fetchAccessoryShortcuts(): Promise<Shortcut[]> {
	return (await getJson<{ shortcuts: Shortcut[] }>('/api/accessory/shortcuts')).shortcuts;
}
