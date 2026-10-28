/**
 * The project's part of the tap page, from `revibase.json`: a style, featured entries and the apps. Pure, like
 * `project-apps.ts`. Everything here is data Revibase renders; the rules and why: ARCHITECTURE.md, "Project page".
 */

import { normalizeMediaUrl } from './mint-media.ts';
import { APPS_VERSION, resolveApps, type AppContext, type ProjectApp } from './project-apps.ts';

/** Who is looking: nobody owns it yet, the connected wallet owns it, or someone else does. */
export type Audience = 'unclaimed' | 'owner' | 'visitor';
const FEATURED_KEYS = ['default', 'unclaimed', 'owner', 'visitor'] as const;
type FeaturedKey = (typeof FEATURED_KEYS)[number];

export type Featured = {
	/** The project's image URL; the server swaps it for a same-origin proxy path. Null shows the NFT art. */
	image: string | null;
	title: string;
	text: string | null;
	/** One of the project's apps, named by its label. */
	button: ProjectApp | null;
};

export type ProjectAccent = {
	color: string;
	/** Whichever of white and the page foreground reads better on `color`. */
	foreground: string;
};

/**
 * A color fills the page as is, and `scheme` says which of Revibase's text palettes reads on it. An image is
 * always blurred and darkened, so it's always the dark palette.
 */
export type ProjectBackground =
	{ kind: 'color'; color: string; scheme: 'light' | 'dark' } | { kind: 'image'; image: string };

export type ProjectStyle = { accent: ProjectAccent | null; background: ProjectBackground | null };

export type ProjectPage = {
	/** The `external_url` hostname, to say whose content this is when the NFT has no collection name. */
	host: string | null;
	style: ProjectStyle;
	featured: Partial<Record<FeaturedKey, Featured>>;
	apps: ProjectApp[];
};

/** The page's one main button. Claim is Revibase's own flow; an app is the project's. */
export type MainButton = { kind: 'claim' } | { kind: 'app'; app: ProjectApp };

export const EMPTY_PAGE: ProjectPage = {
	host: null,
	style: { accent: null, background: null },
	featured: {},
	apps: []
};

export const MAX_TITLE = 30;
export const MAX_TEXT = 56;
export const MAX_BUTTON = 24;
const HEX = /^#[0-9a-f]{6}$/i;
/** The main button can't read like one of Revibase's own flows or a wallet prompt. Matches word starts only. */
const RESERVED =
	/\b(un)?(claim|release|transfer|verif|connect|sign|approv|wallet|recover|seed|revibase)/i;
const WHITE = '#ffffff';
/** `--foreground` in globals.css. */
const INK = '#0e1a1a';

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

export function foregroundFor(color: string): string {
	return contrast(color, WHITE) >= contrast(color, INK) ? WHITE : INK;
}

function hex(raw: unknown): string | null {
	return typeof raw === 'string' && HEX.test(raw) ? raw.toLowerCase() : null;
}

function text(raw: unknown, max: number): string | null {
	return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : null;
}

function resolveStyle(raw: unknown): ProjectStyle {
	const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const accent = hex(s.accent);
	const color = hex(s.background);
	const image = color ? null : normalizeMediaUrl(s.background);
	return {
		accent: accent ? { color: accent, foreground: foregroundFor(accent) } : null,
		background: color
			? { kind: 'color', color, scheme: foregroundFor(color) === WHITE ? 'dark' : 'light' }
			: image
				? { kind: 'image', image }
				: null
	};
}

/** An entry needs a title. A `button` naming no app, or an invalid image, only drops that part. */
function resolveFeatured(raw: unknown, apps: readonly ProjectApp[]): Featured | null {
	if (!raw || typeof raw !== 'object') return null;
	const f = raw as Record<string, unknown>;
	const title = text(f.title, MAX_TITLE);
	if (!title) return null;
	const named = typeof f.button === 'string' ? f.button.trim() : '';
	const app = named ? apps.find((a) => a.label === named) : undefined;
	return {
		image: normalizeMediaUrl(f.image),
		title,
		text: text(f.text, MAX_TEXT),
		// The main button shows no icon, so the project's icon URL never reaches the browser unproxied.
		button: app ? { ...app, icon: null } : null
	};
}

/** A file with another `version` shows nothing. Fields Revibase doesn't know are ignored. */
export function resolvePage(file: unknown, ctx: AppContext): ProjectPage {
	const host = new URL(ctx.externalUrl).hostname.replace(/^www\./, '');
	if (!file || typeof file !== 'object') return { ...EMPTY_PAGE, host };
	const f = file as Record<string, unknown>;
	if (f.version !== APPS_VERSION) return { ...EMPTY_PAGE, host };

	const apps = resolveApps(file, ctx);
	const raw =
		f.featured && typeof f.featured === 'object' ? (f.featured as Record<string, unknown>) : {};
	const featured: ProjectPage['featured'] = {};
	for (const key of FEATURED_KEYS) {
		const entry = resolveFeatured(raw[key], apps);
		if (entry) featured[key] = entry;
	}
	return { host, style: resolveStyle(f.style), featured, apps };
}

/** The entry for this audience, else `default`. */
export function pickFeatured(
	featured: ProjectPage['featured'],
	audience: Audience
): Featured | null {
	return featured[audience] ?? featured.default ?? null;
}

/**
 * Claim whenever the viewer can claim; otherwise the featured button; otherwise none. A label that reads like a
 * Revibase flow shows as "Open" here; the host always shows under it.
 */
export function mainButton(featured: Featured | null, canClaim: boolean): MainButton | null {
	if (canClaim) return { kind: 'claim' };
	const app = featured?.button;
	if (!app) return null;
	const label = app.label.slice(0, MAX_BUTTON).trim();
	return { kind: 'app', app: { ...app, label: RESERVED.test(label) ? 'Open' : label } };
}
