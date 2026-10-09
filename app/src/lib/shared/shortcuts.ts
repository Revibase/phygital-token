/**
 * Phantom-compatible descriptive fields plus HTTPS image icons and explicit Revibase launch modes. Pure: the server fetches the file, the client decides how each link opens.
 * The rules and why they exist: ARCHITECTURE.md, "Project shortcuts".
 */

export const SHORTCUT_ICONS = [
	'vote',
	'vote-2',
	'stake',
	'stake-2',
	'view',
	'chat',
	'tip',
	'mint',
	'mint-2',
	'discord',
	'twitter',
	'x',
	'instagram',
	'telegram',
	'leaderboard',
	'gaming',
	'gaming-2',
	'generic-link',
	'generic-add'
] as const;

export type ShortcutIcon = (typeof SHORTCUT_ICONS)[number];
export type ShortcutPlatform = 'all' | 'desktop' | 'mobile';

export type Shortcut = {
	label: string;
	/** Fully resolved: placeholders filled, scheme and host checked. */
	href: string;
	/** Phantom icon name; `generic-link` when the project gave an image instead. */
	icon: ShortcutIcon;
	/** The project's https icon URL; the server swaps it for a same-origin proxy path. */
	image: string | null;
	/** Asked for with `immerse`, and the server checked its site allows framing. */
	immerse: boolean;
	/** Opening it mints a session proof (through `/shortcut/[n]`); the list never carries one. */
	proof: boolean;
	/** `prefersExternalTarget`: open as a plain link rather than inside a wallet. */
	external: boolean;
	platform: ShortcutPlatform;
};

export type ShortcutContext = {
	externalUrl: string;
	tokenId: string;
	collectionId: string | null;
	ownerAddress: string | null;
};

export const MAX_SHORTCUTS = 8;
const MAX_LABEL = 32;
const MAX_URI = 2048;
/** Placeholder values are Solana addresses: base58 can't contain `/`, `@`, `:` or `.`, so it can't move a link's host. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/** `<external_url>/shortcuts.json`, keeping any path (Phantom honours `example.com/some-id/shortcuts.json`). */
export function shortcutsFileUrl(externalUrl: unknown): string | null {
	if (typeof externalUrl !== 'string' || externalUrl.length > MAX_URI) return null;
	try {
		const url = new URL(externalUrl.trim());
		if (url.protocol !== 'https:' || url.username || url.password) return null;
		url.search = '';
		url.hash = '';
		url.pathname = `${url.pathname.replace(/\/+$/, '')}/shortcuts.json`;
		return url.href;
	} catch {
		return null;
	}
}

function fill(template: string, ctx: ShortcutContext): string | null {
	const values: Record<string, string | null> = {
		tokenId: ctx.tokenId,
		collectionId: ctx.collectionId,
		ownerAddress: ctx.ownerAddress
	};
	let missing = false;
	const out = template.replace(PLACEHOLDER, (_, name: string) => {
		const value = Object.hasOwn(values, name) ? values[name] : null;
		if (!value || !BASE58.test(value)) {
			missing = true;
			return '';
		}
		return encodeURIComponent(value);
	});
	return missing ? null : out;
}

function iconImageUrl(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.length > MAX_URI) return null;
	try {
		const url = new URL(raw.trim());
		return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
	} catch {
		return null;
	}
}

export function withinProject(url: URL, externalUrl: string): boolean {
	const home = new URL(externalUrl).hostname;
	return url.hostname === home || url.hostname.endsWith(`.${home}`);
}

function resolveUri(raw: unknown, external: boolean, ctx: ShortcutContext, explicit = false): string | null {
	if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_URI) return null;
	const filled = fill(raw.trim(), ctx);
	if (!filled) return null;
	let url: URL;
	try {
		url = new URL(filled);
	} catch {
		return null;
	}
	if (url.protocol === 'solana:') return external ? url.href : null; // Solana Pay hands off to the wallet itself
	if (url.protocol !== 'https:' || url.username || url.password) return null;
	if (!explicit && !external && !withinProject(url, ctx.externalUrl)) return null;
	return url.href;
}

/** Invalid entries are skipped, so one bad shortcut can't hide the rest. */
export function resolveShortcuts(file: unknown, ctx: ShortcutContext): Shortcut[] {
	if (!file || typeof file !== 'object') return [];
	const list = (file as { shortcuts?: unknown }).shortcuts;
	if (!Array.isArray(list)) return [];

	const out: Shortcut[] = [];
	for (const entry of list) {
		if (out.length === MAX_SHORTCUTS) break;
		if (!entry || typeof entry !== 'object') continue;
		const s = entry as Record<string, unknown>;

		if (s.type !== undefined && s.type !== 'collectible') continue;
		const label = typeof s.label === 'string' ? s.label.trim().slice(0, MAX_LABEL) : '';
		if (!label) continue;

		const platform = s.platform ?? 'all';
		if (platform !== 'all' && platform !== 'desktop' && platform !== 'mobile') continue;

		const only = Array.isArray(s.limitToCollections) ? s.limitToCollections : [];
		if (only.length > 0 && (!ctx.collectionId || !only.includes(ctx.collectionId))) continue;

		const config = s.revibase;
		if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config))) continue;
		const launch = (config as { launch?: unknown } | undefined)?.launch;
		if (config !== undefined && launch !== 'embed' && launch !== 'wallet' && launch !== 'browser') continue;
		const external = launch ? launch === 'browser' : s.prefersExternalTarget === true;
		const href = resolveUri(s.uri, external, ctx, launch !== undefined);
		if (!href) continue;

		const named = SHORTCUT_ICONS.includes(s.icon as ShortcutIcon);
		const icon = named ? (s.icon as ShortcutIcon) : 'generic-link';
		const image = named ? null : iconImageUrl(s.icon);
		const immerse = launch ? launch === 'embed' : !external && s.preferredPresentation === 'immerse';
		out.push({ label, href, icon, image, immerse, proof: false, external, platform });
	}
	return out;
}

export function shortcutsFor(list: Shortcut[], device: 'desktop' | 'mobile'): Shortcut[] {
	return list.filter((s) => s.platform === 'all' || s.platform === device);
}

export function shortcutDestination(s: Shortcut): string {
	if (s.href.startsWith('solana:')) return 'Solana Pay';
	return new URL(s.href).hostname.replace(/^www\./, '');
}
