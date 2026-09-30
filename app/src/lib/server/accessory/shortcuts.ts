import { fetchAsset, type GetAssetResult } from '$lib/shared/mint-media';
import { resolveShortcuts, shortcutsFileUrl, withinProject, type Shortcut } from '$lib/shared/shortcuts';
import type { AccessoryView } from '$lib/shared/types';
import type { AdmitSession } from '../session/cookies';
import { PROOF_TTL_S, signSessionProof, type ProofKey } from '../session/proof';
import { KNOWN_WALLETS } from '$lib/client/wallet/catalog';

const TIMEOUT_MS = 3_000;
const MAX_BYTES = 64 * 1024;
const CACHE_TTL_S = 600;

/**
 * Fetched by the Worker, never the browser: no CORS needed, and the project never sees the tapper's IP.
 * Any failure on the project's side means no shortcuts.
 */
export async function fetchShortcutsFile(fileUrl: string): Promise<unknown> {
	try {
		const res = await fetch(fileUrl, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cf: { cacheTtl: CACHE_TTL_S, cacheEverything: true }
		} as RequestInit);
		if (!res.ok) return null;
		if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
		const text = await res.text();
		if (text.length > MAX_BYTES) return null;
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function collectionOf(asset: GetAssetResult | undefined): string | null {
	return asset?.grouping?.find((g) => g.group_key === 'collection')?.group_value ?? null;
}

export type ProjectShortcuts = { externalUrl: string | null; shortcuts: Shortcut[] };

/** Throws only when DAS is unreachable, so the client can retry. */
export async function loadShortcuts(rpcUrl: string, accessory: AccessoryView): Promise<ProjectShortcuts> {
	const none = { externalUrl: null, shortcuts: [] };
	if (!accessory.mint) return none;
	const asset = await fetchAsset(rpcUrl, accessory.mint);
	const raw = asset?.content?.links?.external_url;
	const fileUrl = shortcutsFileUrl(raw);
	if (!fileUrl || typeof raw !== 'string') return none;

	const externalUrl = raw.trim();
	const file = await fetchShortcutsFile(fileUrl);
	return {
		externalUrl,
		shortcuts: resolveShortcuts(file, {
			externalUrl,
			tokenId: accessory.mint,
			collectionId: collectionOf(asset),
			ownerAddress: accessory.linkedWallet
		})
	};
}

export const PROOF_PARAM = 'revibase_session';

type ProofOptions = { key: ProofKey | null; issuer: string; session: AdmitSession; accessory: AccessoryView; now?: number };

/**
 * Null when this viewer gets no proofs, including an owner_browse whose wallet is no longer the linked one:
 * that viewer no longer owns what they're looking at.
 */
function proofWindow(project: ProjectShortcuts, opts: ProofOptions): { now: number; exp: number } | null {
	const { key, session, accessory } = opts;
	if (!key || !project.externalUrl || !accessory.mint) return null;
	if (session.t === 'ob' && session.wallet !== accessory.linkedWallet) return null;
	const now = Math.floor((opts.now ?? Date.now()) / 1000);
	const exp = Math.min(now + PROOF_TTL_S, Math.floor(session.exp / 1000));
	return exp > now ? { now, exp } : null;
}

/** Proofs only go to the project itself, never to third-party links. */
function provable(s: Shortcut, externalUrl: string): boolean {
	const url = new URL(s.href);
	return url.protocol === 'https:' && withinProject(url, externalUrl);
}

/** Flags the shortcuts that will get a proof when opened, without signing any. */
export function markProofs(project: ProjectShortcuts, opts: ProofOptions): Shortcut[] {
	const span = proofWindow(project, opts);
	return project.shortcuts.map((s) => ({ ...s, proof: !!span && provable(s, project.externalUrl!) }));
}

/** Signs a fresh proof into each project link. Only called when a shortcut is actually opened. */
export function withSessionProofs(project: ProjectShortcuts, opts: ProofOptions): Shortcut[] {
	const { key, accessory } = opts;
	const { externalUrl, shortcuts } = project;
	const span = proofWindow(project, opts);
	if (!span || !key || !externalUrl) return shortcuts;
	const { now, exp } = span;

	return shortcuts.map((s) => {
		if (!provable(s, externalUrl)) return s;
		const url = new URL(s.href);
		const proof = signSessionProof(key, {
			iss: opts.issuer,
			aud: url.origin,
			iat: now,
			exp,
			jti: crypto.randomUUID(),
			sub: accessory.pda,
			mint: accessory.mint!,
			kind: accessory.kind,
			wallet: accessory.linkedWallet
		});
		url.searchParams.set(PROOF_PARAM, proof);
		return { ...s, href: url.href, proof: true };
	});
}

/** Null for a shortcut that got no proof, so `/shortcut/[n]` is never a general-purpose redirect. */
export function openedLocation(opened: Shortcut, wallet: string | null, origin: string): string | null {
	if (!opened.proof) return null;
	const via = KNOWN_WALLETS.find((w) => w.id === wallet);
	return via && !opened.external ? via.browse(opened.href, origin) : opened.href;
}

export function fromOtherSite(headers: Headers): boolean {
	const site = headers.get('sec-fetch-site');
	return !!site && site !== 'same-origin';
}
