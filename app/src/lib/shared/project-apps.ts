/**
 * Project apps from `revibase.json`. Pure: the server fetches the file, the client decides how each app opens.
 * The rules and why they exist: ARCHITECTURE.md, "Project apps".
 */

export const APPS_FILE = 'revibase.json';
export const APPS_VERSION = 1;


export type ProjectApp = {
	label: string;
	/** Fully resolved: placeholders filled, scheme and host checked. */
	href: string;
	/** The project's https icon URL; the server swaps it for a same-origin proxy path. */
	icon: string | null;
	/** `embed` fills the in-app browser. `tab` opens a new browser tab. */
	open: 'embed' | 'tab';
};

export type AppContext = {
	externalUrl: string;
	mint: string;
	collection: string | null;
	owner: string | null;
	accessory: string;
};

export const MAX_APPS = 8;
const MAX_LABEL = 32;
const MAX_URI = 2048;
/** Placeholder values are Solana addresses: base58 can't contain `/`, `@`, `:` or `.`, so it can't move a link's host. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/** `<external_url>/revibase.json`, keeping any path. */
export function appsFileUrl(externalUrl: unknown): string | null {
	if (typeof externalUrl !== 'string' || externalUrl.length > MAX_URI) return null;
	try {
		const url = new URL(externalUrl.trim());
		if (url.protocol !== 'https:' || url.username || url.password) return null;
		url.search = '';
		url.hash = '';
		url.pathname = `${url.pathname.replace(/\/+$/, '')}/${APPS_FILE}`;
		return url.href;
	} catch {
		return null;
	}
}

function fill(template: string, ctx: AppContext): string | null {
	const values: Record<string, string | null> = {
		mint: ctx.mint,
		collection: ctx.collection,
		owner: ctx.owner,
		accessory: ctx.accessory
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

function resolveUrl(
	raw: unknown,
	open: unknown,
	ctx: AppContext
): { href: string; open: ProjectApp['open'] } | null {
	if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_URI) return null;
	const filled = fill(raw.trim(), ctx);
	if (!filled) return null;
	let url: URL;
	try {
		url = new URL(filled);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password) return null;
	if (open === 'tab') return { href: url.href, open };
	if (open === 'embed' && withinProject(url, ctx.externalUrl)) return { href: url.href, open };
	return null;
}

/** A file with another `version` shows nothing. Invalid entries are skipped, so one bad app can't hide the rest. */
export function resolveApps(file: unknown, ctx: AppContext): ProjectApp[] {
	if (!file || typeof file !== 'object') return [];
	const { version, apps } = file as { version?: unknown; apps?: unknown };
	if (version !== APPS_VERSION || !Array.isArray(apps)) return [];

	const out: ProjectApp[] = [];
	for (const entry of apps) {
		if (out.length === MAX_APPS) break;
		if (!entry || typeof entry !== 'object') continue;
		const a = entry as Record<string, unknown>;

		const label = typeof a.label === 'string' ? a.label.trim().slice(0, MAX_LABEL) : '';
		if (!label) continue;

		const link = resolveUrl(a.url, a.open, ctx);
		if (!link) continue;

		out.push({ label, ...link, icon: iconImageUrl(a.icon) });
	}
	return out;
}

export function appDestination(a: ProjectApp): string {
	return new URL(a.href).hostname.replace(/^www\./, '');
}
