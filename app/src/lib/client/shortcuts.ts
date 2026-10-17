import type { Shortcut } from '$lib/shared/shortcuts';
import { getJson } from './api';

export async function fetchAccessoryShortcuts(): Promise<Shortcut[]> {
	return (await getJson<{ shortcuts: Shortcut[] }>('/api/accessory/shortcuts')).shortcuts;
}

/** A shortcut opens in the in-app browser or a new tab. */
export type ShortcutLaunch = { kind: 'embed'; href: string } | { kind: 'link'; href: string; newTab: true };

export function shortcutLaunch(s: Shortcut): ShortcutLaunch {
	if (s.open === 'tab') return { kind: 'link', href: s.href, newTab: true };
	return { kind: 'embed', href: s.href };
}
